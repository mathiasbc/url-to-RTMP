require('dotenv').config();

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const Koa = require('koa');
const bodyParser = require('koa-bodyparser');
const json = require('koa-json');

class WebToYouTubeStreamer {
  constructor() {
    this.browser = null;
    this.page = null;
    this.ffmpegProcess = null;
    this.isStreaming = false;
    
    this.config = {
      targetUrl: process.env.TARGET_URL || (() => { throw new Error('TARGET_URL environment variable is required') })(),
      youtubeRtmpUrl: process.env.YOUTUBE_RTMP_URL || (() => { throw new Error('YOUTUBE_RTMP_URL environment variable is required') })(),
      youtubeStreamKey: process.env.YOUTUBE_STREAM_KEY || (() => { throw new Error('YOUTUBE_STREAM_KEY environment variable is required') })(),
      accessKeyword: process.env.ACCESS_KEYWORD || '',
      width: parseInt(process.env.STREAM_WIDTH) || 1920,
      height: parseInt(process.env.STREAM_HEIGHT) || 1080,
      fps: parseInt(process.env.STREAM_FPS) || 30,
      bitrate: process.env.STREAM_BITRATE || '7000k',
      port: process.env.PORT || 3000,
      headless: process.env.HEADLESS !== 'false', // Allow override for debugging
      // New optimization: Screenshot interval in seconds (default: 10 seconds for slow-changing content)
      screenshotInterval: parseInt(process.env.SCREENSHOT_INTERVAL) || 10
    };

    console.log('Web Streamer initialized with config:', {
      ...this.config,
      youtubeStreamKey: '[HIDDEN]',
      accessKeyword: this.config.accessKeyword ? '[HIDDEN]' : '[NOT SET]'
    });
  }

  async initializeBrowser() {
    console.log('Initializing Playwright browser...');
    
    // Launch Chromium with optimized settings for cloud deployment
    this.browser = await chromium.launch({
      headless: this.config.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--memory-pressure-off',
        '--max_old_space_size=4096'
      ]
    });

    this.page = await this.browser.newPage();
    
    // Set viewport to match stream dimensions
    await this.page.setViewportSize({
      width: this.config.width,
      height: this.config.height
    });

    // Block unnecessary resources to improve performance
    await this.page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['stylesheet', 'font', 'image', 'media'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Set additional page settings for better performance
    await this.page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    console.log('Browser initialized successfully');
  }

  async startFFmpeg() {
    console.log('Starting FFmpeg for web page streaming...');
    
    const rtmpUrl = `${this.config.youtubeRtmpUrl.replace(/\/$/, '')}/${this.config.youtubeStreamKey}`;
    console.log('Streaming to:', rtmpUrl.replace(this.config.youtubeStreamKey, '[STREAM_KEY_HIDDEN]'));
    
    const ffmpegArgs = [
      '-f', 'image2pipe',
      '-vcodec', 'png',
      // Use a very low input framerate since we're feeding images slowly
      '-r', '0.1', // 0.1 fps input (1 frame every 10 seconds)
      '-i', '-',
      // Audio (required for YouTube Live) - Fixed syntax
      '-f', 'lavfi',
      '-i', 'anullsrc=r=44100:cl=stereo',
      // Video encoding optimized for YouTube Live with frame duplication
      '-vcodec', 'libx264',
      '-preset', 'fast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-level', '4.0',
      // Output framerate - FFmpeg will duplicate frames to reach this
      '-r', this.config.fps.toString(),
      '-g', (this.config.fps * 2).toString(),
      '-keyint_min', this.config.fps.toString(),
      '-b:v', this.config.bitrate,
      '-maxrate', this.config.bitrate,
      '-bufsize', (parseInt(this.config.bitrate) * 2) + 'k',
      // Frame duplication filter to smooth out the low input framerate
      '-vf', `fps=${this.config.fps}`,
      // Additional encoding optimizations
      '-sc_threshold', '0',
      '-flags', '+cgop',
      '-bf', '2',
      // Audio encoding (enhanced)
      '-c:a', 'aac',
      '-b:a', '160k',
      '-ar', '44100',
      '-ac', '2',
      // Output format optimized for streaming
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      '-strict', 'experimental',
      rtmpUrl
    ];

    this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    this.ffmpegProcess.stdin.on('error', (err) => {
      console.error('FFmpeg stdin error:', err);
    });

    this.ffmpegProcess.stderr.on('data', (data) => {
      const message = data.toString();
      if (message.includes('error') || message.includes('Error')) {
        console.error('FFmpeg error:', message);
      } else if (message.includes('fps=')) {
        // Log detailed streaming status
        const fps = message.match(/fps=\s*(\d+)/);
        const bitrate = message.match(/bitrate=\s*([0-9.]+[kmg]?bits\/s)/i);
        const time = message.match(/time=\s*([0-9:.]+)/);
        if (fps || bitrate || time) {
          console.log(`Stream status - FPS: ${fps?.[1] || 'N/A'}, Bitrate: ${bitrate?.[1] || 'N/A'}, Time: ${time?.[1] || 'N/A'}`);
        }
      } else if (message.includes('rtmp://')) {
        // Log RTMP connection status
        console.log('RTMP status:', message.trim());
      } else if (message.includes('Connection to') || message.includes('Stream mapping:')) {
        // Log important connection and stream info
        console.log('FFmpeg info:', message.trim());
      }
    });

    this.ffmpegProcess.on('close', (code) => {
      console.log(`FFmpeg process exited with code ${code}`);
      this.isStreaming = false;
    });

    console.log('FFmpeg started successfully');
  }

  async captureAndStream() {
    if (!this.page || !this.ffmpegProcess) {
      throw new Error('Browser or FFmpeg not initialized');
    }

    console.log(`Loading page: ${this.config.targetUrl}`);
    
    try {
      await this.page.goto(this.config.targetUrl, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      
      // Wait additional time for dynamic content to load
      console.log('Page loaded, waiting for content to stabilize...');
      await this.page.waitForTimeout(3000);
      
    } catch (error) {
      console.error('Failed to load page:', error);
      throw error;
    }

    console.log(`Page ready, starting optimized web capture (screenshot every ${this.config.screenshotInterval}s)...`);
    this.isStreaming = true;

    // Optimized capture loop - takes screenshots much less frequently
    const captureLoop = async () => {
      let screenshotCount = 0;
      
      while (this.isStreaming && this.ffmpegProcess && !this.ffmpegProcess.killed) {
        try {
          const startTime = Date.now();
          
          const screenshot = await this.page.screenshot({
            type: 'png',
            fullPage: false
          });

          if (this.ffmpegProcess.stdin.writable) {
            this.ffmpegProcess.stdin.write(screenshot);
            screenshotCount++;
            
            const captureTime = Date.now() - startTime;
            console.log(`Screenshot ${screenshotCount} captured in ${captureTime}ms (next in ${this.config.screenshotInterval}s)`);
          } else {
            console.log('FFmpeg stdin not writable, stopping capture');
            break;
          }

          // Wait for the configured screenshot interval (much longer than before)
          await new Promise(resolve => setTimeout(resolve, this.config.screenshotInterval * 1000));
          
        } catch (error) {
          console.error('Screenshot error:', error);
          // Try to reload the page if screenshot fails
          try {
            await this.page.reload({ waitUntil: 'networkidle' });
            console.log('Page reloaded successfully');
          } catch (reloadError) {
            console.error('Page reload failed:', reloadError);
            break;
          }
        }
      }
    };

    captureLoop();
  }

  async startStreaming() {
    try {
      if (this.isStreaming) {
        console.log('Already streaming');
        return { success: false, message: 'Already streaming' };
      }

      if (!this.config.youtubeStreamKey) {
        throw new Error('YouTube stream key not provided');
      }

      console.log('Starting web streaming process...');
      await this.initializeBrowser();
      await this.startFFmpeg();
      await this.captureAndStream();

      console.log('Web streaming started successfully');
      return { success: true, message: 'Web streaming started' };
    } catch (error) {
      console.error('Error starting stream:', error);
      await this.stopStreaming();
      return { success: false, message: error.message };
    }
  }

  async stopStreaming() {
    console.log('Stopping stream...');
    this.isStreaming = false;

    if (this.ffmpegProcess) {
      this.ffmpegProcess.stdin.end();
      this.ffmpegProcess.kill('SIGTERM');
      this.ffmpegProcess = null;
    }

    if (this.page) {
      await this.page.close();
      this.page = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    console.log('Stream stopped');
    return { success: true, message: 'Stream stopped' };
  }

  getStatus() {
    return {
      isStreaming: this.isStreaming,
      targetUrl: this.config.targetUrl,
      streamType: 'web-capture',
      hasStreamKey: !!this.config.youtubeStreamKey,
      hasAccessKeyword: !!this.config.accessKeyword,
      config: {
        width: this.config.width,
        height: this.config.height,
        fps: this.config.fps,
        bitrate: this.config.bitrate,
        headless: this.config.headless,
        screenshotInterval: this.config.screenshotInterval
      }
    };
  }

  validateKeyword(providedKeyword) {
    if (!this.config.accessKeyword) {
      throw new Error('Access keyword not configured');
    }
    return providedKeyword === this.config.accessKeyword;
  }
}

// Koa server setup
const app = new Koa();
const streamer = new WebToYouTubeStreamer();

app.use(json());
app.use(bodyParser());

// Error handling
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.status = err.statusCode || err.status || 500;
    ctx.body = { success: false, message: err.message };
    console.error('Request error:', err);
  }
});

// Routes
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/') {
    ctx.body = {
      service: 'YouTube Screen Streamer',
      status: 'running',
      streamer: streamer.getStatus()
    };
    return;
  }
  await next();
});

app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/start') {
    const { keyword } = ctx.request.body || {};
    
    if (!streamer.validateKeyword(keyword)) {
      ctx.status = 401;
      ctx.body = { success: false, message: 'Invalid access keyword' };
      return;
    }
    
    const result = await streamer.startStreaming();
    ctx.body = result;
    return;
  }
  await next();
});

app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/stop') {
    const { keyword } = ctx.request.body || {};
    
    if (!streamer.validateKeyword(keyword)) {
      ctx.status = 401;
      ctx.body = { success: false, message: 'Invalid access keyword' };
      return;
    }
    
    const result = await streamer.stopStreaming();
    ctx.body = result;
    return;
  }
  await next();
});

app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/status') {
    ctx.body = streamer.getStatus();
    return;
  }
  await next();
});

app.use(async (ctx) => {
  ctx.status = 404;
  ctx.body = { success: false, message: 'Endpoint not found' };
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully');
  await streamer.stopStreaming();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully');
  await streamer.stopStreaming();
  process.exit(0);
});

// Auto-start streaming if environment variable is set
if (process.env.AUTO_START === 'true') {
  console.log('Auto-start enabled, starting stream in 10 seconds...');
  setTimeout(() => {
    streamer.startStreaming().catch(console.error);
  }, 10000);
}

const PORT = streamer.config.port;
app.listen(PORT, () => {
  console.log(`YouTube Web Streamer running on port ${PORT}`);
  console.log(`Target URL: ${streamer.config.targetUrl}`);
  console.log(`Visit http://localhost:${PORT} for status`);
  console.log(`POST /start with keyword to begin streaming`);
  console.log(`POST /stop with keyword to end streaming`);
  console.log(`Keyword authentication: ${streamer.config.accessKeyword ? 'ENABLED' : 'DISABLED'}`);
});

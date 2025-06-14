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
      // New optimization: Screenshot interval in seconds (supports decimal values like 0.5)
      screenshotInterval: parseFloat(process.env.SCREENSHOT_INTERVAL) || 1.0
    };

    console.log('Web Streamer initialized with config:', {
      ...this.config,
      youtubeStreamKey: '[HIDDEN]',
      accessKeyword: this.config.accessKeyword ? '[HIDDEN]' : '[NOT SET]'
    });
  }

  async initializeBrowser() {
    console.log('Initializing Playwright browser...');
    
    // Launch Chromium with optimized settings for cloud deployment and fast screenshots
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
        '--max_old_space_size=4096',
        // Additional performance optimizations for faster screenshots
        '--disable-extensions',
        '--disable-plugins',
        '--disable-images',
        '--disable-javascript',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--run-all-compositor-stages-before-draw',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-default-browser-check',
        '--no-pings',
        '--password-store=basic',
        '--use-mock-keychain'
      ]
    });

    this.page = await this.browser.newPage();
    
    // Set viewport to match stream dimensions
    await this.page.setViewportSize({
      width: this.config.width,
      height: this.config.height
    });

    // Aggressive resource blocking for maximum performance
    await this.page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      const url = route.request().url();
      
      // Block everything except the main document and essential scripts
      if (resourceType === 'document' || 
          (resourceType === 'script' && url.includes('liberator-bitcoin-dashboard'))) {
        route.continue();
      } else {
        route.abort();
      }
    });

    // Disable animations and transitions for faster rendering
    await this.page.addInitScript(() => {
      // Disable CSS animations and transitions
      const style = document.createElement('style');
      style.textContent = `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `;
      document.head.appendChild(style);
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
    
    // Calculate input framerate based on screenshot interval
    const inputFramerate = (1 / this.config.screenshotInterval).toFixed(3);
    console.log(`FFmpeg input framerate: ${inputFramerate} fps (1 frame every ${this.config.screenshotInterval}s)`);
    
    // Enhanced bitrate calculation - ensure minimum for YouTube Live
    const baseBitrate = parseInt(this.config.bitrate);
    const minBitrate = this.config.width >= 1920 ? 6000 : 4000; // 6Mbps for 1080p, 4Mbps for 720p
    const targetBitrate = Math.max(baseBitrate, minBitrate);
    const maxBitrate = Math.floor(targetBitrate * 1.2);
    const bufferSize = targetBitrate * 2;
    
    console.log(`Bitrate optimization: target=${targetBitrate}k, max=${maxBitrate}k, buffer=${bufferSize}k`);
    
    const ffmpegArgs = [
      // Input settings optimized for PNG screenshots
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-r', inputFramerate,
      '-i', '-',
      
      // Audio (required for YouTube Live)
      '-f', 'lavfi',
      '-i', 'anullsrc=r=44100:cl=stereo',
      
      // Video encoding optimized for YouTube Live streaming
      '-c:v', 'libx264',
      '-preset', 'veryfast', // Changed from 'fast' for better real-time performance
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-level', '4.2', // Increased from 4.0 for better quality
      
      // Frame rate and GOP settings
      '-r', this.config.fps.toString(),
      '-g', (this.config.fps * 2).toString(), // GOP size
      '-keyint_min', this.config.fps.toString(),
      
      // Enhanced bitrate control
      '-b:v', `${targetBitrate}k`,
      '-maxrate', `${maxBitrate}k`,
      '-bufsize', `${bufferSize}k`,
      '-crf', '23', // Add constant rate factor for quality
      
      // Advanced video filters for smooth playback
      '-vf', `fps=${this.config.fps},scale=${this.config.width}:${this.config.height}:flags=lanczos`,
      
      // Advanced encoding optimizations for streaming
      '-x264-params', 'nal-hrd=cbr:force-cfr=1',
      '-sc_threshold', '0',
      '-flags', '+cgop+global_header',
      '-bf', '0', // Disable B-frames for lower latency
      '-refs', '3',
      '-me_method', 'hex',
      '-subq', '6',
      '-trellis', '1',
      
      // Audio encoding (enhanced for better compatibility)
      '-c:a', 'aac',
      '-b:a', '160k',
      '-ar', '44100',
      '-ac', '2',
      '-profile:a', 'aac_low',
      
      // Output format optimized for RTMP streaming
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      
      // Additional streaming optimizations
      '-avoid_negative_ts', 'make_zero',
      '-fflags', '+genpts',
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
        const speed = message.match(/speed=\s*([0-9.]+x)/);
        if (fps || bitrate || time) {
          console.log(`Stream status - FPS: ${fps?.[1] || 'N/A'}, Bitrate: ${bitrate?.[1] || 'N/A'}, Time: ${time?.[1] || 'N/A'}, Speed: ${speed?.[1] || 'N/A'}`);
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

    console.log('FFmpeg started successfully with enhanced streaming parameters');
  }

  async captureAndStream() {
    if (!this.page || !this.ffmpegProcess) {
      throw new Error('Browser or FFmpeg not initialized');
    }

    console.log(`Loading page: ${this.config.targetUrl}`);
    
    try {
      // Optimized page loading with shorter timeouts
      await this.page.goto(this.config.targetUrl, { 
        waitUntil: 'domcontentloaded', // Changed from 'networkidle' for faster loading
        timeout: 15000 // Reduced from 30000ms
      });
      
      // Minimal wait for essential content - reduced from 3000ms
      console.log('Page loaded, waiting for content to stabilize...');
      await this.page.waitForTimeout(1000);
      
      // Pre-warm the screenshot engine
      console.log('Pre-warming screenshot engine...');
      await this.page.screenshot({
        type: 'png',
        fullPage: false,
        clip: { x: 0, y: 0, width: 100, height: 100 } // Small test screenshot
      });
      
    } catch (error) {
      console.error('Failed to load page:', error);
      throw error;
    }

    console.log(`Page ready, starting optimized web capture (screenshot every ${this.config.screenshotInterval}s)...`);
    this.isStreaming = true;

    // High-performance capture loop with optimizations
    const captureLoop = async () => {
      let screenshotCount = 0;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 5;
      
      while (this.isStreaming && this.ffmpegProcess && !this.ffmpegProcess.killed) {
        try {
          const startTime = Date.now();
          
          // Optimized screenshot with minimal options for speed
          const screenshot = await this.page.screenshot({
            type: 'png',
            fullPage: false,
            omitBackground: false,
            // Removed clip to capture full viewport
            optimizeForSpeed: true // Playwright optimization flag
          });

          if (this.ffmpegProcess.stdin.writable) {
            this.ffmpegProcess.stdin.write(screenshot);
            screenshotCount++;
            consecutiveErrors = 0; // Reset error counter on success
            
            const captureTime = Date.now() - startTime;
            const nextInterval = this.config.screenshotInterval;
            
            // Log performance metrics
            if (captureTime > 500) {
              console.log(`⚠️  Screenshot ${screenshotCount} captured in ${captureTime}ms (SLOW - next in ${nextInterval}s)`);
            } else {
              console.log(`✅ Screenshot ${screenshotCount} captured in ${captureTime}ms (next in ${nextInterval}s)`);
            }
            
            // Performance warning if consistently slow
            if (screenshotCount % 10 === 0 && captureTime > 300) {
              console.log(`📊 Performance check: Average capture time is high. Consider optimizing page content or increasing SCREENSHOT_INTERVAL.`);
            }
            
          } else {
            console.log('FFmpeg stdin not writable, stopping capture');
            break;
          }

          // Efficient wait with early termination check
          const waitStart = Date.now();
          const waitTime = this.config.screenshotInterval * 1000;
          
          await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
              if (!this.isStreaming || (Date.now() - waitStart >= waitTime)) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 100); // Check every 100ms for early termination
          });
          
        } catch (error) {
          consecutiveErrors++;
          console.error(`Screenshot error (${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);
          
          if (consecutiveErrors >= maxConsecutiveErrors) {
            console.error('Too many consecutive screenshot errors, attempting page reload...');
            try {
              await this.page.reload({ 
                waitUntil: 'domcontentloaded',
                timeout: 10000 
              });
              await this.page.waitForTimeout(1000);
              console.log('Page reloaded successfully');
              consecutiveErrors = 0;
            } catch (reloadError) {
              console.error('Page reload failed:', reloadError.message);
              console.error('Stopping stream due to persistent errors');
              break;
            }
          } else {
            // Short wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      console.log('Capture loop ended');
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

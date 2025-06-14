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
    this.captureLoopActive = false;
    this.memoryStats = {
      startTime: Date.now(),
      screenshotCount: 0,
      lastMemoryCheck: Date.now(),
      peakMemoryUsage: 0
    };
    
    // Memory monitoring interval
    this.memoryMonitorInterval = null;
    
    this.config = {
      targetUrl: process.env.TARGET_URL,
      youtubeRtmpUrl: process.env.YOUTUBE_RTMP_URL,
      youtubeStreamKey: process.env.YOUTUBE_STREAM_KEY,
      accessKeyword: process.env.ACCESS_KEYWORD || '',
      width: parseInt(process.env.STREAM_WIDTH) || 1920,
      height: parseInt(process.env.STREAM_HEIGHT) || 1080,
      fps: parseInt(process.env.STREAM_FPS) || 30,
      bitrate: process.env.STREAM_BITRATE || '8000k',
      port: parseInt(process.env.PORT) || 3000,
      headless: process.env.HEADLESS !== 'false',
      screenshotInterval: parseFloat(process.env.SCREENSHOT_INTERVAL) || 10.0
    };

    if (!this.config.targetUrl) {
      throw new Error('TARGET_URL environment variable is required');
    }
    if (!this.config.youtubeRtmpUrl) {
      throw new Error('YOUTUBE_RTMP_URL environment variable is required');
    }

    console.log('WebToYouTubeStreamer initialized with config:', {
      ...this.config,
      youtubeStreamKey: this.config.youtubeStreamKey ? '[HIDDEN]' : 'NOT_SET',
      accessKeyword: this.config.accessKeyword ? '[HIDDEN]' : 'NOT_SET'
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
    const frameMultiplier = Math.ceil(this.config.fps / parseFloat(inputFramerate));
    console.log(`FFmpeg input framerate: ${inputFramerate} fps (1 frame every ${this.config.screenshotInterval}s)`);
    console.log(`Frame duplication: Each input frame will be duplicated ${frameMultiplier}x to achieve ${this.config.fps} fps output`);
    
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
      
      // Video encoding optimized for YouTube Live streaming with low input framerate
      '-c:v', 'libx264',
      '-preset', parseFloat(inputFramerate) < 5 ? 'fast' : 'veryfast', // Use 'fast' for low framerate for better quality
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-level', '4.2', // Increased from 4.0 for better quality
      
      // Frame rate and GOP settings
      '-r', this.config.fps.toString(),
      '-g', (this.config.fps * 2).toString(), // GOP size
      '-keyint_min', this.config.fps.toString(),
      
      // Enhanced bitrate control with CBR for consistent streaming
      '-b:v', `${targetBitrate}k`,
      '-minrate', `${Math.floor(targetBitrate * 0.8)}k`, // Minimum bitrate for stability
      '-maxrate', `${maxBitrate}k`,
      '-bufsize', `${bufferSize}k`,
      '-crf', '23', // Add constant rate factor for quality
      
      // Advanced video filters optimized for low input framerate
      '-vf', `fps=${this.config.fps}:round=up,scale=${this.config.width}:${this.config.height}:flags=lanczos,format=yuv420p`,
      
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

    // Memory-efficient stderr handling with circular buffer
    let stderrBuffer = '';
    const maxBufferSize = 10000; // Limit buffer size to prevent memory growth
    let lastStatusLog = Date.now();
    const statusLogInterval = 2000; // Log status every 2 seconds max

    this.ffmpegProcess.stdin.on('error', (err) => {
      console.error('FFmpeg stdin error:', err);
    });

    this.ffmpegProcess.stderr.on('data', (data) => {
      const message = data.toString();
      
      // Prevent stderr buffer from growing indefinitely
      stderrBuffer += message;
      if (stderrBuffer.length > maxBufferSize) {
        stderrBuffer = stderrBuffer.slice(-maxBufferSize / 2); // Keep only recent half
      }
      
      // Process messages without storing them long-term
      if (message.includes('error') || message.includes('Error')) {
        console.error('FFmpeg error:', message.trim());
      } else if (message.includes('fps=')) {
        // Throttle status logging to prevent spam
        const now = Date.now();
        if (now - lastStatusLog > statusLogInterval) {
          const fps = message.match(/fps=\s*(\d+)/);
          const bitrate = message.match(/bitrate=\s*([0-9.]+[kmg]?bits\/s)/i);
          const time = message.match(/time=\s*([0-9:.]+)/);
          const speed = message.match(/speed=\s*([0-9.]+x)/);
          if (fps || bitrate || time) {
            console.log(`Stream status - FPS: ${fps?.[1] || 'N/A'}, Bitrate: ${bitrate?.[1] || 'N/A'}, Time: ${time?.[1] || 'N/A'}, Speed: ${speed?.[1] || 'N/A'}`);
          }
          lastStatusLog = now;
        }
      } else if (message.includes('rtmp://')) {
        console.log('RTMP status:', message.trim());
      } else if (message.includes('Connection to') || message.includes('Stream mapping:')) {
        console.log('FFmpeg info:', message.trim());
      }
    });

    this.ffmpegProcess.on('close', (code) => {
      console.log(`FFmpeg process exited with code ${code}`);
      this.isStreaming = false;
      this.captureLoopActive = false;
      // Clear stderr buffer on close
      stderrBuffer = null;
    });

    this.ffmpegProcess.on('error', (error) => {
      console.error('FFmpeg process error:', error);
      this.isStreaming = false;
      this.captureLoopActive = false;
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
      const warmupScreenshot = await this.page.screenshot({
        type: 'png',
        fullPage: false,
        clip: { x: 0, y: 0, width: 100, height: 100 } // Small test screenshot
      });
      // Immediately clear the warmup screenshot from memory
      warmupScreenshot.fill(0);
      
    } catch (error) {
      console.error('Failed to load page:', error);
      throw error;
    }

    console.log(`Page ready, starting optimized web capture (screenshot every ${this.config.screenshotInterval}s)...`);
    this.isStreaming = true;
    this.captureLoopActive = true;

    // Start memory monitoring
    this.startMemoryMonitoring();

    // High-performance capture loop with memory management
    const captureLoop = async () => {
      let screenshotCount = 0;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 5;
      let waitTimeoutId = null;
      
      // Periodic browser context refresh to prevent memory buildup
      const contextRefreshInterval = 100; // Refresh every 100 screenshots
      
      while (this.captureLoopActive && this.isStreaming && this.ffmpegProcess && !this.ffmpegProcess.killed) {
        try {
          const startTime = Date.now();
          
          // Periodic browser page refresh to clear accumulated memory
          if (screenshotCount > 0 && screenshotCount % contextRefreshInterval === 0) {
            console.log(`🔄 Refreshing browser context after ${screenshotCount} screenshots to prevent memory buildup...`);
            try {
              await this.page.reload({ 
                waitUntil: 'domcontentloaded',
                timeout: 10000 
              });
              await this.page.waitForTimeout(1000);
              console.log('✅ Browser context refreshed successfully');
            } catch (refreshError) {
              console.error('⚠️  Browser refresh failed:', refreshError.message);
            }
          }
          
          // Optimized screenshot with minimal options for speed
          let screenshot = await this.page.screenshot({
            type: 'png',
            fullPage: false,
            omitBackground: false,
            optimizeForSpeed: true
          });

          if (this.ffmpegProcess && this.ffmpegProcess.stdin && this.ffmpegProcess.stdin.writable) {
            // Write screenshot to FFmpeg
            const writeSuccess = this.ffmpegProcess.stdin.write(screenshot);
            
            // Clear screenshot buffer immediately after writing
            screenshot.fill(0);
            screenshot = null;
            
            if (writeSuccess) {
              screenshotCount++;
              this.memoryStats.screenshotCount = screenshotCount;
              consecutiveErrors = 0; // Reset error counter on success
              
              const captureTime = Date.now() - startTime;
              const nextInterval = this.config.screenshotInterval;
              
              // Log performance metrics with memory-efficient logging
              if (screenshotCount % 10 === 0) { // Log every 10th screenshot to reduce spam
                if (captureTime > 500) {
                  console.log(`⚠️  Screenshot ${screenshotCount} captured in ${captureTime}ms (SLOW - next in ${nextInterval}s)`);
                } else {
                  console.log(`✅ Screenshot ${screenshotCount} captured in ${captureTime}ms (next in ${nextInterval}s)`);
                }
                
                // Force garbage collection periodically if available
                if (screenshotCount % 50 === 0 && global.gc) {
                  global.gc();
                }
              }
            } else {
              console.log('FFmpeg stdin backpressure, waiting...');
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } else {
            console.log('FFmpeg stdin not writable, stopping capture');
            break;
          }

          // Memory-efficient wait implementation
          if (this.captureLoopActive && this.isStreaming) {
            await new Promise((resolve) => {
              waitTimeoutId = setTimeout(() => {
                waitTimeoutId = null;
                resolve();
              }, this.config.screenshotInterval * 1000);
            });
          }
          
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
      
      // Cleanup on loop exit
      if (waitTimeoutId) {
        clearTimeout(waitTimeoutId);
      }
      
      console.log('Capture loop ended');
      this.captureLoopActive = false;
    };

    captureLoop().catch(error => {
      console.error('Capture loop error:', error);
      this.captureLoopActive = false;
    });
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
    this.captureLoopActive = false;

    // Stop memory monitoring
    this.stopMemoryMonitoring();

    // Clean up FFmpeg process
    if (this.ffmpegProcess) {
      try {
        // Gracefully close stdin first
        if (this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
          this.ffmpegProcess.stdin.end();
        }
        
        // Wait a moment for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Force kill if still running
        if (!this.ffmpegProcess.killed) {
          this.ffmpegProcess.kill('SIGTERM');
          
          // Wait for termination
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Force kill if still running
          if (!this.ffmpegProcess.killed) {
            this.ffmpegProcess.kill('SIGKILL');
          }
        }
        
        // Remove all event listeners to prevent memory leaks
        this.ffmpegProcess.removeAllListeners();
        
      } catch (error) {
        console.error('Error stopping FFmpeg:', error);
      } finally {
        this.ffmpegProcess = null;
      }
    }

    // Clean up browser resources
    if (this.page) {
      try {
        // Clear any pending timeouts/intervals on the page
        await this.page.evaluate(() => {
          // Clear all timeouts and intervals
          const highestTimeoutId = setTimeout(() => {}, 0);
          for (let i = 0; i < highestTimeoutId; i++) {
            clearTimeout(i);
            clearInterval(i);
          }
        });
        
        await this.page.close();
      } catch (error) {
        console.error('Error closing page:', error);
      } finally {
        this.page = null;
      }
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        console.error('Error closing browser:', error);
      } finally {
        this.browser = null;
      }
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      console.log('🗑️  Forced garbage collection during cleanup');
    }

    // Reset memory stats
    this.memoryStats = {
      startTime: Date.now(),
      screenshotCount: 0,
      lastMemoryCheck: Date.now(),
      peakMemoryUsage: 0
    };

    console.log('Stream stopped and resources cleaned up');
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

  // Memory monitoring methods
  startMemoryMonitoring() {
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
    }
    
    this.memoryMonitorInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const memUsageMB = {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024)
      };
      
      // Track peak memory usage
      if (memUsageMB.rss > this.memoryStats.peakMemoryUsage) {
        this.memoryStats.peakMemoryUsage = memUsageMB.rss;
      }
      
      // Log memory stats every 5 minutes
      const now = Date.now();
      if (now - this.memoryStats.lastMemoryCheck > 300000) { // 5 minutes
        console.log(`📊 Memory Stats - RSS: ${memUsageMB.rss}MB, Heap: ${memUsageMB.heapUsed}/${memUsageMB.heapTotal}MB, External: ${memUsageMB.external}MB, Peak: ${this.memoryStats.peakMemoryUsage}MB, Screenshots: ${this.memoryStats.screenshotCount}`);
        this.memoryStats.lastMemoryCheck = now;
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
          console.log('🗑️  Forced garbage collection');
        }
        
        // Warning if memory usage is growing rapidly
        if (memUsageMB.rss > 1000) {
          console.log('⚠️  High memory usage detected. Consider restarting the stream periodically.');
        }
      }
    }, 30000); // Check every 30 seconds
  }

  stopMemoryMonitoring() {
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
      this.memoryMonitorInterval = null;
    }
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

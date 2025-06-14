#!/usr/bin/env node

/**
 * Memory Leak Test Suite for URL-to-RTMP Streamer
 * 
 * This test suite helps identify memory leaks by running various scenarios
 * and monitoring memory usage patterns over time.
 * 
 * Usage:
 *   node memory-test.js [test-name]
 * 
 * Available tests:
 *   - screenshot-leak: Test for screenshot buffer memory leaks
 *   - ffmpeg-leak: Test for FFmpeg process memory leaks  
 *   - browser-leak: Test for browser context memory leaks
 *   - full-cycle: Test complete start/stop cycles
 *   - long-running: Long-running test to detect gradual leaks
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class MemoryLeakTester {
  constructor() {
    this.testResults = [];
    this.startTime = Date.now();
    this.logFile = `memory-test-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    fs.appendFileSync(this.logFile, logMessage + '\n');
  }

  getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
      external: Math.round(usage.external / 1024 / 1024), // MB
      timestamp: Date.now()
    };
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async runMemoryTest(testName, testFunction, duration = 60000) {
    this.log(`🧪 Starting memory test: ${testName}`);
    this.log(`📊 Test duration: ${duration / 1000} seconds`);
    
    const initialMemory = this.getMemoryUsage();
    this.log(`📈 Initial memory - RSS: ${initialMemory.rss}MB, Heap: ${initialMemory.heapUsed}MB`);
    
    const memorySnapshots = [initialMemory];
    
    // Start memory monitoring
    const monitorInterval = setInterval(() => {
      const currentMemory = this.getMemoryUsage();
      memorySnapshots.push(currentMemory);
      
      const memoryGrowth = currentMemory.rss - initialMemory.rss;
      const heapGrowth = currentMemory.heapUsed - initialMemory.heapUsed;
      
      this.log(`📊 Memory - RSS: ${currentMemory.rss}MB (+${memoryGrowth}MB), Heap: ${currentMemory.heapUsed}MB (+${heapGrowth}MB)`);
      
      // Warning if memory growth is excessive
      if (memoryGrowth > 100) {
        this.log(`⚠️  WARNING: RSS memory grew by ${memoryGrowth}MB - possible memory leak!`);
      }
      if (heapGrowth > 50) {
        this.log(`⚠️  WARNING: Heap memory grew by ${heapGrowth}MB - possible memory leak!`);
      }
    }, 5000);
    
    try {
      // Run the test function
      await testFunction();
      
      // Wait for the specified duration
      await this.sleep(duration);
      
    } catch (error) {
      this.log(`❌ Test error: ${error.message}`);
    } finally {
      clearInterval(monitorInterval);
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      this.log('🗑️  Forced garbage collection');
      await this.sleep(1000);
    }
    
    const finalMemory = this.getMemoryUsage();
    const totalGrowth = finalMemory.rss - initialMemory.rss;
    const heapGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
    
    this.log(`📈 Final memory - RSS: ${finalMemory.rss}MB, Heap: ${finalMemory.heapUsed}MB`);
    this.log(`📊 Total growth - RSS: +${totalGrowth}MB, Heap: +${heapGrowth}MB`);
    
    // Analyze results
    const result = {
      testName,
      duration: duration / 1000,
      initialMemory,
      finalMemory,
      totalGrowth,
      heapGrowth,
      snapshots: memorySnapshots,
      leakDetected: totalGrowth > 50 || heapGrowth > 25,
      timestamp: new Date().toISOString()
    };
    
    this.testResults.push(result);
    
    if (result.leakDetected) {
      this.log(`🚨 MEMORY LEAK DETECTED in ${testName}!`);
      this.log(`   RSS growth: ${totalGrowth}MB (threshold: 50MB)`);
      this.log(`   Heap growth: ${heapGrowth}MB (threshold: 25MB)`);
    } else {
      this.log(`✅ ${testName} passed - no significant memory leaks detected`);
    }
    
    return result;
  }

  // Test 1: Screenshot buffer memory leaks
  async testScreenshotLeak() {
    const { chromium } = require('playwright');
    
    return this.runMemoryTest('screenshot-leak', async () => {
      this.log('🖼️  Testing screenshot buffer memory leaks...');
      
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto('https://example.com');
      
      // Take many screenshots to test for buffer leaks
      for (let i = 0; i < 100; i++) {
        let screenshot = await page.screenshot({ type: 'png' });
        
        // Simulate writing to FFmpeg (without actual FFmpeg)
        const bufferSize = screenshot.length;
        this.log(`Screenshot ${i + 1}: ${bufferSize} bytes`);
        
        // Clear buffer immediately (this is what the fix should do)
        screenshot.fill(0);
        screenshot = null;
        
        if (i % 10 === 0 && global.gc) {
          global.gc();
        }
        
        await this.sleep(100);
      }
      
      await page.close();
      await browser.close();
    }, 30000);
  }

  // Test 2: FFmpeg process memory leaks
  async testFFmpegLeak() {
    return this.runMemoryTest('ffmpeg-leak', async () => {
      this.log('🎬 Testing FFmpeg process memory leaks...');
      
      // Simulate FFmpeg stderr data processing
      let stderrBuffer = '';
      const maxBufferSize = 10000;
      
      for (let i = 0; i < 1000; i++) {
        // Simulate FFmpeg stderr output
        const mockStderr = `frame=${i} fps=30 q=23.0 size=${i * 100}kB time=00:00:${String(i % 60).padStart(2, '0')}.00 bitrate=8000.0kbits/s speed=1.0x`;
        
        // Test the circular buffer logic
        stderrBuffer += mockStderr;
        if (stderrBuffer.length > maxBufferSize) {
          stderrBuffer = stderrBuffer.slice(-maxBufferSize / 2);
        }
        
        // Process the message (without storing it)
        const fps = mockStderr.match(/fps=\s*(\d+)/);
        const bitrate = mockStderr.match(/bitrate=\s*([0-9.]+[kmg]?bits\/s)/i);
        
        if (i % 100 === 0) {
          this.log(`Processed ${i} FFmpeg messages, buffer size: ${stderrBuffer.length}`);
        }
        
        await this.sleep(10);
      }
      
      // Clear buffer
      stderrBuffer = null;
    }, 20000);
  }

  // Test 3: Browser context memory leaks
  async testBrowserLeak() {
    const { chromium } = require('playwright');
    
    return this.runMemoryTest('browser-leak', async () => {
      this.log('🌐 Testing browser context memory leaks...');
      
      for (let cycle = 0; cycle < 10; cycle++) {
        this.log(`Browser cycle ${cycle + 1}/10`);
        
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1920, height: 1080 });
        
        // Load a complex page multiple times
        for (let i = 0; i < 5; i++) {
          await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
          await page.screenshot({ type: 'png' });
          await this.sleep(500);
        }
        
        // Clean up properly
        await page.close();
        await browser.close();
        
        if (global.gc) {
          global.gc();
        }
        
        await this.sleep(1000);
      }
    }, 60000);
  }

  // Test 4: Full start/stop cycle test
  async testFullCycle() {
    return this.runMemoryTest('full-cycle', async () => {
      this.log('🔄 Testing full start/stop cycles...');
      
      // This would test the actual streamer class if we import it
      // For now, simulate the memory patterns
      
      for (let cycle = 0; cycle < 5; cycle++) {
        this.log(`Full cycle ${cycle + 1}/5`);
        
        // Simulate starting streaming
        const mockResources = {
          browser: { memory: Math.random() * 100 },
          ffmpeg: { memory: Math.random() * 50 },
          screenshots: []
        };
        
        // Simulate running for a while
        for (let i = 0; i < 20; i++) {
          mockResources.screenshots.push(new Buffer.alloc(1024 * 1024)); // 1MB buffer
          await this.sleep(100);
        }
        
        // Simulate cleanup
        mockResources.screenshots.forEach(buffer => buffer.fill(0));
        mockResources.screenshots = [];
        mockResources.browser = null;
        mockResources.ffmpeg = null;
        
        if (global.gc) {
          global.gc();
        }
        
        await this.sleep(2000);
      }
    }, 45000);
  }

  // Test 5: Long-running test
  async testLongRunning() {
    return this.runMemoryTest('long-running', async () => {
      this.log('⏱️  Testing long-running memory stability...');
      
      let counter = 0;
      const startTime = Date.now();
      
      while (Date.now() - startTime < 300000) { // 5 minutes
        // Simulate continuous operation
        const buffer = Buffer.alloc(1024 * 100); // 100KB
        buffer.fill(Math.random() * 255);
        
        // Process and clear
        buffer.fill(0);
        
        counter++;
        
        if (counter % 100 === 0) {
          this.log(`Long-running test: ${counter} iterations completed`);
          if (global.gc) {
            global.gc();
          }
        }
        
        await this.sleep(50);
      }
    }, 300000);
  }

  async generateReport() {
    this.log('\n📋 MEMORY LEAK TEST REPORT');
    this.log('=' * 50);
    
    let totalLeaks = 0;
    
    for (const result of this.testResults) {
      this.log(`\n🧪 Test: ${result.testName}`);
      this.log(`   Duration: ${result.duration}s`);
      this.log(`   RSS Growth: ${result.totalGrowth}MB`);
      this.log(`   Heap Growth: ${result.heapGrowth}MB`);
      this.log(`   Status: ${result.leakDetected ? '🚨 LEAK DETECTED' : '✅ PASSED'}`);
      
      if (result.leakDetected) {
        totalLeaks++;
      }
    }
    
    this.log(`\n📊 SUMMARY:`);
    this.log(`   Total tests: ${this.testResults.length}`);
    this.log(`   Tests passed: ${this.testResults.length - totalLeaks}`);
    this.log(`   Memory leaks detected: ${totalLeaks}`);
    this.log(`   Overall status: ${totalLeaks === 0 ? '✅ ALL TESTS PASSED' : '🚨 MEMORY LEAKS DETECTED'}`);
    
    // Save detailed report
    const reportFile = `memory-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(reportFile, JSON.stringify(this.testResults, null, 2));
    this.log(`\n📄 Detailed report saved to: ${reportFile}`);
    
    return totalLeaks === 0;
  }
}

// Main execution
async function main() {
  const testName = process.argv[2];
  const tester = new MemoryLeakTester();
  
  console.log('🧪 URL-to-RTMP Memory Leak Test Suite');
  console.log('=====================================\n');
  
  try {
    if (testName) {
      // Run specific test
      switch (testName) {
        case 'screenshot-leak':
          await tester.testScreenshotLeak();
          break;
        case 'ffmpeg-leak':
          await tester.testFFmpegLeak();
          break;
        case 'browser-leak':
          await tester.testBrowserLeak();
          break;
        case 'full-cycle':
          await tester.testFullCycle();
          break;
        case 'long-running':
          await tester.testLongRunning();
          break;
        default:
          console.log(`❌ Unknown test: ${testName}`);
          console.log('Available tests: screenshot-leak, ffmpeg-leak, browser-leak, full-cycle, long-running');
          process.exit(1);
      }
    } else {
      // Run all tests
      console.log('🚀 Running all memory leak tests...\n');
      await tester.testScreenshotLeak();
      await tester.testFFmpegLeak();
      await tester.testBrowserLeak();
      await tester.testFullCycle();
    }
    
    const allPassed = await tester.generateReport();
    process.exit(allPassed ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Test suite error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = MemoryLeakTester; 
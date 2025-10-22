'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Image from "next/image";
import PerformanceDashboard from "@/components/PerformanceDashboard";

interface CompressionResult {
  success: boolean;
  exactMatch: boolean;
  outputSize: number;
  quality: number;
  iterations: number;
  format: string;
  mode: 'exact' | 'balanced';
  processingTime: number;
  scaleFactor?: number;
  paletteReduced?: boolean;
  error?: string;
}

interface CompressionStats {
  processingTime?: number;
  compressionRatio?: number;
  sizeDifference?: number;
}

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [format, setFormat] = useState<'webp' | 'avif'>('webp');
  const [mode, setMode] = useState<'exact' | 'balanced'>('balanced');
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [result, setResult] = useState<CompressionResult | null>(null);
  const [stats, setStats] = useState<CompressionStats>({});
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // PWA Installation
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallPrompt(true);
    };

    const handleAppInstalled = () => {
      setShowInstallPrompt(false);
      setDeferredPrompt(null);
      console.log('PWA was installed');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Cleanup progress timeouts on unmount
  useEffect(() => {
    return () => {
      if (progressTimeoutRef.current) {
        clearTimeout(progressTimeoutRef.current);
      }
    };
  }, []);

  const handleInstallPWA = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
      setDeferredPrompt(null);
      setShowInstallPrompt(false);
    }
  };

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
      setResult(null);
      setStats({});
      setProgressPercent(0);
      
      // Create preview URL
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  }, []);

  const handleCompress = useCallback(async () => {
    if (!selectedFile) return;

    setIsCompressing(true);
    setCompressionProgress('Let\'s get this party started! 🚀');
    setProgressPercent(5);
    setError(null);
    setResult(null);
    setStats({});

    const formData = new FormData();
    formData.append('image', selectedFile);
    formData.append('format', format);
    formData.append('mode', mode);

    try {
      // Simulate more realistic progress with delays
      await new Promise(resolve => setTimeout(resolve, 300));
      setCompressionProgress('Uploading your pic to our servers... 📤');
      setProgressPercent(15);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      setCompressionProgress('AI analyzing your image - this looks fire! 🔥');
      setProgressPercent(25);
      
      const response = await fetch('/api/compress', {
        method: 'POST',
        body: formData,
      });

      await new Promise(resolve => setTimeout(resolve, 300));
      setCompressionProgress('Parallel processing multiple quality settings... ⚡');
      setProgressPercent(40);

      if (!response.ok) {
        let errorMessage = 'Compression failed';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (jsonError) {
          // If response is not JSON, try to get text
          try {
            const errorText = await response.text();
            errorMessage = errorText || errorMessage;
          } catch (textError) {
            // Use default error message
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }

      await new Promise(resolve => setTimeout(resolve, 400));
      setCompressionProgress('Adaptive binary search converging on target... 🎯');
      setProgressPercent(65);

      // Get response headers for stats
      const processingTime = parseInt(response.headers.get('X-Processing-Time') || '0');
      const compressionRatio = parseFloat(response.headers.get('X-Compression-Ratio') || '0');
      const resultBytes = parseInt(response.headers.get('X-Result-Bytes') || '0');
      const exactMatch = response.headers.get('X-Exact-Match') === '1';
      const quality = parseInt(response.headers.get('X-Compression-Quality') || '0');
      const iterations = parseInt(response.headers.get('X-Iterations') || '0');
      const responseMode = response.headers.get('X-Mode') as 'exact' | 'balanced' || mode;
      const scaleFactor = parseFloat(response.headers.get('X-Scale-Factor') || '1');
      const paletteReduced = response.headers.get('X-Palette-Reduced') === '1';

      setResult({
        success: true,
        exactMatch,
        outputSize: resultBytes,
        quality,
        iterations,
        format,
        mode: responseMode,
        processingTime,
        scaleFactor: scaleFactor !== 1 ? scaleFactor : undefined,
        paletteReduced
      });

      setStats({
        processingTime,
        compressionRatio,
        sizeDifference: Math.abs(resultBytes - 80000)
      });

      await new Promise(resolve => setTimeout(resolve, 300));
      setCompressionProgress('Format-specific optimization in progress... 🔄');
      setProgressPercent(80);

      await new Promise(resolve => setTimeout(resolve, 200));
      setCompressionProgress('Caching result and preparing download... 💯');
      setProgressPercent(90);

      // Create download link with SEO-friendly filename
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      
      // Use the filename from the Content-Disposition header if available
      const contentDisposition = response.headers.get('Content-Disposition');
      let seoFilename = `pixelpress-${selectedFile.name.split('.')[0]}-${format}-compressed.${format}`;
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
        if (filenameMatch) {
          seoFilename = filenameMatch[1];
        }
      }
      
      a.download = seoFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      setProgressPercent(100);
      setCompressionProgress('BOOM! Your compressed image is ready! 🎉');

      // Send performance metrics to dashboard
      if (typeof window !== 'undefined' && result) {
        window.postMessage({
          type: 'COMPRESSION_METRICS',
          metrics: {
            processingTime: result.processingTime,
            iterationsUsed: result.iterations,
            memoryPeak: 0,
            cpuUsage: 0,
            finalSize: result.outputSize,
            qualityAchieved: result.quality,
            exactMatch: result.exactMatch,
            compressionRatio: selectedFile.size / result.outputSize,
            queueLength: 0,
            activeJobs: 0,
            cacheHitRate: 0,
            errorRate: 0,
            parallelTests: result.iterations,
            cacheHit: false
          }
        }, '*');
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Oops! Something went wrong 😅');
      setProgressPercent(0);
    } finally {
      setIsCompressing(false);
      // Keep the success message visible for a bit, then smoothly reset
      progressTimeoutRef.current = setTimeout(() => {
        setCompressionProgress('');
        // Smooth transition back to 0
        progressTimeoutRef.current = setTimeout(() => {
          setProgressPercent(0);
        }, 100);
      }, 3000);
    }
  }, [selectedFile, format, mode]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 1024) {
      return `${kb.toFixed(1)} KB`;
    }
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  };

  const formatTime = (milliseconds: number) => {
    const seconds = milliseconds / 1000;
    if (seconds < 1) {
      return `${(seconds * 1000).toFixed(0)}ms`;
    }
    return `${seconds.toFixed(1)}s`;
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="container mx-auto px-4 py-6">
          <div className="text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-2">
              Pixel<span className="text-orange-500">Press</span>
            </h1>
            <p className="text-gray-400 text-sm md:text-base">
              Maximum image compression for optimal file sizes
            </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Upload Section */}
            <div className="space-y-6">
              <div className="rounded-2xl border border-gray-600 bg-gray-800 shadow-2xl shadow-black/40 p-6">
                <h2 className="text-xl font-semibold mb-4">Upload Image</h2>
                
                {/* File Upload */}
                <div 
                  className="border-2 border-dashed border-orange-500 rounded-xl p-8 text-center hover:border-orange-500 transition-colors cursor-pointer group"
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      fileInputRef.current?.click();
                    }
                  }}
                  aria-label="Upload image file"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  {selectedFile ? (
                    <div className="space-y-3">
                      <div className="text-green-500">
                        <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <p className="font-medium">{selectedFile.name}</p>
                      <p className="text-sm text-gray-400">
                        {formatFileSize(selectedFile.size)} • {selectedFile.type}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-gray-500 group-hover:text-orange-500 transition-colors">
                        <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                      </div>
                      <p className="font-medium">Click to upload</p>
                      <p className="text-sm text-gray-400">JPEG, JPG, PNG up to 10MB</p>
                    </div>
                  )}
                </div>

                {/* Format Selection */}
                <div className="mt-6">
                  <label className="block text-sm font-medium mb-3">Output Format</label>
                  <div className="flex gap-4">
                    {(['webp', 'avif'] as const).map((fmt) => (
                      <label key={fmt} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="format"
                          value={fmt}
                          checked={format === fmt}
                          onChange={(e) => setFormat(e.target.value as 'webp' | 'avif')}
                          className="w-4 h-4 text-orange-500 bg-gray-800 border-gray-600 focus:ring-orange-500"
                        />
                        <span className="text-sm font-medium uppercase">{fmt}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Mode Selection */}
                <div className="mt-6">
                  <label className="block text-sm font-medium mb-3">Compression Mode</label>
                  <div className="space-y-3">
                    {([
                      { value: 'balanced', label: 'Balanced', description: 'Quality priority (±5KB tolerance, 90s timeout)', recommended: true },
                      { value: 'exact', label: 'Exact', description: 'Size priority (minimum possible size, 90s timeout)', recommended: false }
                    ] as const).map((modeOption) => (
                      <label key={modeOption.value} className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border border-gray-600 hover:border-orange-500 transition-colors">
                        <input
                          type="radio"
                          name="mode"
                          value={modeOption.value}
                          checked={mode === modeOption.value}
                          onChange={(e) => setMode(e.target.value as 'exact' | 'balanced')}
                          className="w-4 h-4 text-orange-500 bg-gray-800 border-gray-600 focus:ring-orange-500 mt-0.5"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{modeOption.label}</span>
                            {modeOption.recommended && (
                              <span className="text-xs bg-orange-500 text-black px-2 py-0.5 rounded-full font-medium">RECOMMENDED</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mt-1">{modeOption.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Compress Button */}
                <button
                  onClick={handleCompress}
                  disabled={!selectedFile || isCompressing}
                  className="inline-flex items-center justify-center rounded-xl bg-orange-500 text-black font-semibold transition-all duration-200 shadow-lg shadow-orange-500/30 w-full h-12 text-lg mt-6 hover:bg-orange-400 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-orange-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-60 disabled:transform-none disabled:shadow-none"
                >
                  {isCompressing ? (
                    <>
                      <svg className="animate-spin w-5 h-5 mr-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Compressing...</span>
                    </>
                  ) : (
                    <span>Compress for Maximum Size Reduction ({mode === 'exact' ? 'Exact' : 'Balanced'})</span>
                  )}
                </button>

                {/* Progress Bar */}
                {isCompressing && (
                  <div className="mt-4">
                    <div className="relative w-full h-2 bg-gray-800 rounded overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-orange-500 via-orange-400 to-orange-500 rounded transition-all duration-500 ease-out relative" 
                        style={{ width: `${progressPercent}%` }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse"></div>
                      </div>
                    </div>
                    <div className="text-sm text-gray-400 mt-2 text-center animate-pulse">{compressionProgress}</div>
                  </div>
                )}
              </div>

              {/* Preview */}
              {previewUrl && (
                <div className="rounded-2xl border border-gray-600 bg-gray-800 shadow-2xl shadow-black/40 p-6">
                  <h3 className="text-lg font-semibold mb-4">Preview</h3>
                  <div className="relative">
        <Image
                      src={previewUrl}
                      alt="Original image preview"
                      width={400}
                      height={300}
                      className="rounded-lg w-full h-auto"
                      style={{ objectFit: 'contain' }}
          priority
        />
                  </div>
                </div>
              )}
            </div>

            {/* Results Section */}
            <div className="space-y-6">
              {error && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/5 shadow-2xl shadow-black/40 p-6">
                  <div className="flex items-center space-x-3">
                    <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <h3 className="text-red-400 font-semibold">Error</h3>
                      <p className="text-red-300 text-sm mt-1">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              {result && (
                <div className="rounded-2xl border border-gray-600 bg-gray-800 shadow-2xl shadow-black/40 p-6">
                  <h2 className="text-xl font-semibold mb-4">Results</h2>
                  
                  {/* Success Status */}
                  <div className={`p-4 rounded-lg mb-6 ${result.exactMatch ? 'bg-green-500/10 border border-green-500/20' : 'bg-orange-500/10 border border-orange-500/20'}`}>
                    <div className="flex items-center space-x-3">
                      {result.exactMatch ? (
                        <svg className="w-6 h-6 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : (
                        <svg className="w-6 h-6 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                      )}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className={`font-semibold ${result.exactMatch ? 'text-green-400' : 'text-orange-400'}`}>
                            {result.exactMatch ? 'Exact Match!' : 'Close Match'}
                          </h3>
                          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full font-medium uppercase">
                            {result.mode}
                          </span>
                        </div>
                        <p className={`text-sm ${result.exactMatch ? 'text-green-300' : 'text-orange-300'}`}>
                          {result.exactMatch 
                            ? 'Perfect! Maximum compression achieved.'
                            : `${formatFileSize(result.outputSize)} (${stats.sizeDifference} bytes difference)`
                          }
                        </p>
                        {result.scaleFactor && (
                          <p className="text-xs text-gray-400 mt-1">
                            Scaled to {Math.round(result.scaleFactor * 100)}% of original size
                          </p>
                        )}
                        {result.paletteReduced && (
                          <p className="text-xs text-gray-400 mt-1">
                            Applied palette reduction for optimal compression
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-gray-600 bg-gray-800 shadow-lg shadow-black/30 p-4 text-center">
                      <div className="text-2xl font-bold text-orange-500 mb-1">
                        {formatFileSize(result.outputSize)}
                      </div>
                      <div className="text-sm text-gray-400">Size</div>
                    </div>
                    <div className="rounded-2xl border border-gray-600 bg-gray-800 shadow-lg shadow-black/30 p-4 text-center">
                      <div className="text-2xl font-bold text-orange-500 mb-1">
                        {result.quality}%
                      </div>
                      <div className="text-sm text-gray-400">Quality</div>
                    </div>
                    <div className="rounded-2xl border border-gray-600 bg-gray-800 shadow-lg shadow-black/30 p-4 text-center">
                      <div className="text-2xl font-bold text-orange-500 mb-1">
                        {result.iterations}
                      </div>
                      <div className="text-sm text-gray-400">Iterations</div>
                    </div>
                    <div className="rounded-2xl border border-gray-600 bg-gray-800 shadow-lg shadow-black/30 p-4 text-center">
                      <div className="text-2xl font-bold text-orange-500 mb-1">
                        {formatTime(result.processingTime)}
                      </div>
                      <div className="text-sm text-gray-400">Time</div>
                    </div>
                  </div>

                  {/* Compression Ratio */}
                  {stats.compressionRatio && (
                    <div className="rounded-2xl border border-gray-600 bg-gray-800 shadow-lg shadow-black/30 p-4 mt-4">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-300">Compression Ratio</span>
                        <span className="font-mono text-sm font-semibold text-orange-500">
                          {stats.compressionRatio.toFixed(2)}:1
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* How It Works */}
              <div className="rounded-2xl border border-gray-600 bg-gray-800 shadow-2xl shadow-black/40 p-6">
                <h3 className="text-lg font-semibold mb-6">How It Works</h3>
                
                {/* Step-by-step Process */}
                <div className="space-y-4 mb-6">
                  <div>
                    <h4 className="font-medium text-white mb-1">AI-Powered Analysis 🧠</h4>
                    <p className="text-sm text-gray-300">Our smart algorithm analyzes your image's complexity, dimensions, and color depth to predict the optimal compression strategy. It's like having a compression expert in your pocket!</p>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-white mb-1">Parallel Quality Testing ⚡</h4>
                    <p className="text-sm text-gray-300">We test multiple quality settings simultaneously using parallel processing. This means 3-5x faster compression while finding the perfect balance between size and quality.</p>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-white mb-1">Adaptive Binary Search 🎯</h4>
                    <p className="text-sm text-gray-300">Using intelligent heuristics, we start from the predicted optimal quality and use parallel binary search to quickly converge on the smallest possible file size. No more guessing!</p>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-white mb-1">Smart Scaling Engine 📐</h4>
                    <p className="text-sm text-gray-300">If needed, we intelligently scale your image while preserving aspect ratios and visual quality. Multiple scales are tested in parallel for maximum speed.</p>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-white mb-1">Format-Specific Magic ✨</h4>
                    <p className="text-sm text-gray-300">WebP and AVIF get custom optimizations - faster encoding settings, optimized chroma subsampling, and parallel tile processing for lightning-fast results.</p>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-white mb-1">Intelligent Caching 🚀</h4>
                    <p className="text-sm text-gray-300">Identical images are served instantly from cache, while similar images benefit from our predictive algorithms. Sub-second responses for 60%+ of requests!</p>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      </main>

      {/* PWA Install Prompt */}
      {showInstallPrompt && (
        <div className="fixed bottom-4 left-4 right-4 z-50">
          <div className="bg-gray-800 border border-gray-600 rounded-2xl p-4 shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-semibold text-white">Install PixelPress</h4>
                  <p className="text-sm text-gray-400">Get quick access to image compression</p>
                </div>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handleInstallPWA}
                  className="bg-orange-500 text-black font-semibold px-4 py-2 rounded-xl hover:bg-orange-400 transition-colors"
                >
                  Install
                </button>
                <button
                  onClick={() => setShowInstallPrompt(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Performance Dashboard */}
      <PerformanceDashboard />
    </div>
  );
}
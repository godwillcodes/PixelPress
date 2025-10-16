'use client';

import { useState, useEffect } from 'react';

interface PerformanceMetrics {
  processingTime: number;
  iterationsUsed: number;
  memoryPeak: number;
  cpuUsage: number;
  finalSize: number;
  qualityAchieved: number;
  exactMatch: boolean;
  compressionRatio: number;
  queueLength: number;
  activeJobs: number;
  cacheHitRate: number;
  errorRate: number;
  parallelTests?: number;
  cacheHit?: boolean;
}

interface PerformanceDashboardProps {
  className?: string;
}

export default function PerformanceDashboard({ className = '' }: PerformanceDashboardProps) {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Listen for performance metrics from compression results
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'COMPRESSION_METRICS') {
        setMetrics(event.data.metrics);
        setIsVisible(true);
        
        // Auto-hide after 5 seconds
        setTimeout(() => setIsVisible(false), 5000);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (!isVisible || !metrics) return null;

  const getPerformanceGrade = (processingTime: number): string => {
    if (processingTime < 3000) return 'A+';
    if (processingTime < 5000) return 'A';
    if (processingTime < 8000) return 'B';
    if (processingTime < 12000) return 'C';
    return 'D';
  };

  const getEfficiencyColor = (grade: string): string => {
    switch (grade) {
      case 'A+': return 'text-green-400';
      case 'A': return 'text-green-500';
      case 'B': return 'text-yellow-500';
      case 'C': return 'text-orange-500';
      default: return 'text-red-500';
    }
  };

  const grade = getPerformanceGrade(metrics.processingTime);

  return (
    <div className={`fixed top-4 right-4 z-50 ${className}`}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 shadow-2xl shadow-black/40 max-w-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">Performance Metrics</h3>
          <div className={`text-2xl font-bold ${getEfficiencyColor(grade)}`}>
            {grade}
          </div>
        </div>

        <div className="space-y-3">
          {/* Processing Time */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Processing Time</span>
            <span className="text-sm font-medium text-white">
              {(metrics.processingTime / 1000).toFixed(2)}s
            </span>
          </div>

          {/* Iterations Used */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Iterations</span>
            <span className="text-sm font-medium text-white">
              {metrics.iterationsUsed}
              {metrics.parallelTests && (
                <span className="text-xs text-orange-400 ml-1">
                  ({metrics.parallelTests} parallel)
                </span>
              )}
            </span>
          </div>

          {/* Compression Ratio */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Compression</span>
            <span className="text-sm font-medium text-white">
              {metrics.compressionRatio.toFixed(1)}:1
            </span>
          </div>

          {/* Cache Hit */}
          {metrics.cacheHit && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Cache</span>
              <span className="text-sm font-medium text-green-400">HIT</span>
            </div>
          )}

          {/* Quality Achieved */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Quality</span>
            <span className="text-sm font-medium text-white">
              {metrics.qualityAchieved}%
            </span>
          </div>

          {/* Exact Match */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Match</span>
            <span className={`text-sm font-medium ${metrics.exactMatch ? 'text-green-400' : 'text-orange-400'}`}>
              {metrics.exactMatch ? 'EXACT' : 'CLOSE'}
            </span>
          </div>

          {/* System Status */}
          <div className="border-t border-gray-700 pt-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Active Jobs</span>
              <span className="text-sm font-medium text-white">
                {metrics.activeJobs}/20
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Cache Hit Rate</span>
              <span className="text-sm font-medium text-white">
                {(metrics.cacheHitRate * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Performance Indicator */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Performance</span>
            <span>{grade}</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div 
              className={`h-2 rounded-full transition-all duration-500 ${
                grade === 'A+' ? 'bg-gradient-to-r from-green-400 to-green-500' :
                grade === 'A' ? 'bg-gradient-to-r from-green-500 to-green-600' :
                grade === 'B' ? 'bg-gradient-to-r from-yellow-500 to-yellow-600' :
                grade === 'C' ? 'bg-gradient-to-r from-orange-500 to-orange-600' :
                'bg-gradient-to-r from-red-500 to-red-600'
              }`}
              style={{ 
                width: `${Math.max(20, Math.min(100, 100 - (metrics.processingTime / 100))}%` 
              }}
            />
          </div>
        </div>

        {/* Close Button */}
        <button
          onClick={() => setIsVisible(false)}
          className="absolute top-2 right-2 text-gray-500 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

import Link from 'next/link';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="text-center max-w-md mx-auto">
        <div className="mb-8">
          <h1 className="text-6xl font-bold text-orange-500 mb-4">Exact80</h1>
          <div className="w-16 h-1 bg-orange-500 mx-auto"></div>
        </div>
        
        <h2 className="text-2xl font-semibold mb-4">You're Offline</h2>
        <p className="text-gray-400 mb-8 leading-relaxed">
          It looks like you're not connected to the internet. Some features may not be available while offline.
        </p>
        
        <div className="space-y-4">
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-orange-500 text-black font-semibold py-3 px-6 rounded-xl hover:bg-orange-400 transition-colors"
          >
            Try Again
          </button>
          
          <Link
            href="/"
            className="block w-full border border-gray-600 text-white font-medium py-3 px-6 rounded-xl hover:bg-gray-800 transition-colors"
          >
            Go Home
          </Link>
        </div>
        
        <div className="mt-8 text-sm text-gray-500">
          <p>Exact80 works best when connected to the internet for image compression.</p>
        </div>
      </div>
    </div>
  );
}

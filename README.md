# Exact80

**Precision image compression targeting exactly 80,000 bytes**

A high-performance web application that compresses images to exactly 80KB using advanced binary search algorithms and intelligent quality adjustment. Built with Next.js, Sharp, and TypeScript.

## Features

- **Byte-Exact Compression**: Targets exactly 80,000 bytes using binary search
- **Format Support**: WebP and AVIF output with JPEG/PNG input
- **Adaptive Algorithms**: Parallel processing with intelligent quality estimation
- **Progressive Scaling**: Dimension reduction when quality adjustment isn't sufficient
- **Real-time Metrics**: Processing time, compression ratio, and iteration tracking

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## API Usage

```bash
curl -X POST http://localhost:3000/api/compress \
  -F "image=@photo.jpg" \
  -F "format=webp" \
  --output compressed.webp
```

## Architecture

### Core Algorithm
- **Binary Search**: Quality values (1-100) with tolerance-based convergence
- **Parallel Processing**: Multiple quality tests for faster optimization
- **Adaptive Heuristics**: Image complexity analysis for better starting points
- **Fallback Scaling**: Dimension reduction for exact byte targeting

### Technology Stack
- **Next.js 15.5.5** - App Router with React Server Components
- **Sharp 0.34.4** - High-performance image processing
- **TypeScript 5.0** - Type-safe development
- **Tailwind CSS 4.0** - Utility-first styling

## Performance

| Format | Processing Time | Compression Ratio |
|--------|----------------|-------------------|
| WebP   | 100-300ms     | 8-15:1           |
| AVIF   | 200-500ms     | 12-20:1          |

## Development

```bash
pnpm dev          # Development server
pnpm build        # Production build
pnpm start        # Production server
pnpm lint         # Code linting
```

## License

MIT License - see [LICENSE](LICENSE) for details.
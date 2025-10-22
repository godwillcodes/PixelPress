# PixelPress 🎨

**Maximum image compression for optimal file sizes**

A high-performance web application that compresses images to achieve the smallest possible file size while maintaining visual quality. Built with Next.js, Sharp, and TypeScript using advanced binary search algorithms and intelligent quality adjustment.

## ✨ Features

- **🎯 Maximum Compression**: Targets the smallest possible file size (minimum 1KB) using intelligent algorithms
- **🖼️ Format Support**: WebP and AVIF output with JPEG/PNG input
- **⚡ Adaptive Algorithms**: Parallel processing with intelligent quality estimation
- **📐 Progressive Scaling**: Dimension reduction when quality adjustment isn't sufficient
- **📊 Real-time Metrics**: Processing time, compression ratio, and iteration tracking
- **🚀 PWA Support**: Install as a Progressive Web App for offline use
- **💾 Smart Caching**: Intelligent caching system for faster subsequent compressions

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## 🔧 API Usage

```bash
curl -X POST http://localhost:3000/api/compress \
  -F "image=@photo.jpg" \
  -F "format=webp" \
  -F "mode=balanced" \
  --output compressed.webp
```

### API Parameters

- `image`: Input image file (JPEG, JPG, PNG)
- `format`: Output format (`webp` or `avif`)
- `mode`: Compression mode (`balanced` or `exact`)

## 🏗️ Architecture

### Core Algorithm
- **🔍 Binary Search**: Quality values (1-100) with tolerance-based convergence
- **⚡ Parallel Processing**: Multiple quality tests for faster optimization
- **🧠 Adaptive Heuristics**: Image complexity analysis for better starting points
- **📏 Fallback Scaling**: Dimension reduction for maximum compression

### Technology Stack

<div align="center">

| Technology | Version | Purpose | Icon |
|------------|---------|---------|------|
| **Next.js** | 15.5.5 | React framework with App Router | ![Next.js](https://img.shields.io/badge/Next.js-15.5.5-black?style=flat-square&logo=next.js) |
| **React** | 19.1.0 | UI library | ![React](https://img.shields.io/badge/React-19.1.0-blue?style=flat-square&logo=react) |
| **TypeScript** | 5.0 | Type-safe development | ![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript) |
| **Sharp** | 0.34.4 | High-performance image processing | ![Sharp](https://img.shields.io/badge/Sharp-0.34.4-green?style=flat-square&logo=sharp) |
| **Tailwind CSS** | 4.0 | Utility-first styling | ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?style=flat-square&logo=tailwind-css) |
| **Formidable** | 3.5.4 | File upload handling | ![Formidable](https://img.shields.io/badge/Formidable-3.5.4-orange?style=flat-square) |

</div>

## 📈 Performance

| Format | Processing Time | Compression Ratio | Quality Range |
|--------|----------------|-------------------|---------------|
| **WebP** | 100-300ms | 8-15:1 | 60-95% |
| **AVIF** | 200-500ms | 12-20:1 | 60-95% |

## 🛠️ Development

```bash
# Development commands
pnpm dev          # Start development server
pnpm build        # Production build
pnpm start        # Production server
pnpm lint         # Code linting
```

## 🎨 Compression Modes

### Balanced Mode (Recommended)
- **Quality Priority**: Maintains visual quality with ±5KB tolerance
- **Timeout**: 90 seconds
- **Use Case**: General purpose compression

### Exact Mode
- **Size Priority**: Targets minimum possible file size
- **Timeout**: 90 seconds  
- **Use Case**: Maximum compression when file size is critical

## 🔧 Configuration

The compression behavior can be customized in `src/lib/config.ts`:

```typescript
export const COMPRESSION_CONFIG: CompressionConfig = {
  targetBytes: 1_000,        // Minimum possible size (1KB)
  toleranceBalanced: 5_000,  // Balanced mode tolerance
  toleranceExact: 0,         // Exact mode tolerance
  maxFileSize: 25 * 1024 * 1024, // 25MB max input
  maxWallTimeBalanced: 20_000,   // 20 seconds
  maxWallTimeExact: 25_000,      // 25 seconds
};
```

## 📱 PWA Features

- **📲 Installable**: Add to home screen on mobile devices
- **🔄 Offline Support**: Works without internet connection
- **⚡ Fast Loading**: Optimized for performance
- **📊 Performance Dashboard**: Real-time compression metrics

## 🚀 Deployment

### Vercel (Recommended)
```bash
# Deploy to Vercel
vercel --prod
```

### Docker
```bash
# Build Docker image
docker build -t pixelpress .

# Run container
docker run -p 3000:3000 pixelpress
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🌟 Acknowledgments

- Built with ❤️ using Next.js and Sharp
- Inspired by the need for maximum image compression
- Special thanks to the open-source community

---

<div align="center">

**PixelPress** - Maximum image compression for optimal file sizes

[![Live Demo](https://img.shields.io/badge/Live%20Demo-pixelpress.vercel.app-orange?style=for-the-badge&logo=vercel)](https://pixelpress.vercel.app)
[![GitHub](https://img.shields.io/badge/GitHub-godwillcodes%2FPixelPress-black?style=for-the-badge&logo=github)](https://github.com/godwillcodes/PixelPress)

</div>
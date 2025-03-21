# DebugMaster

DebugMaster is an intelligent debugging-as-a-service application that leverages AI to automatically analyze, diagnose, and fix bugs in your codebase. It integrates with Sentry for error detection and GitHub for automated pull request creation.

## 🌟 Features

### Core Functionality
- **AI-Powered Bug Analysis**: Automatically analyzes errors and generates intelligent fixes
- **Deep Codebase Understanding**: Builds a comprehensive knowledge graph of your codebase
- **Automated Fix Generation**: Creates pull requests with fixes and detailed explanations
- **Cross-File Analysis**: Understands complex relationships between files and components
- **Test-Aware Fixes**: Ensures fixes don't break existing functionality

### Advanced Context Building
- **Knowledge Graph**: Maps dependencies and relationships between files
- **Code Analysis**: Analyzes import statements and function calls
- **Git History**: Leverages Git history for pattern recognition
- **Sequential Thinking**: Breaks down complex bugs into manageable parts
- **Test Coverage**: Includes test files in analysis context

### CI/CD Integration
- **GitHub Actions**: Automated workflows for scheduled analysis
- **Webhook Support**: Real-time issue processing from Sentry
- **Rate Limiting**: Smart API quota management
- **Performance Monitoring**: Track success rates and processing times
- **Interactive Dashboard**: Visualize automated bug fixes

### Monitoring & Analytics
- **Issue Tracking**: Monitor issues processed and fixes attempted
- **Success Metrics**: Track fix success rates and processing times
- **Error Logging**: Comprehensive error and edge case logging
- **Performance Reports**: Regular summary reports of service performance

## 🚀 Getting Started

### Prerequisites
- Node.js 20.x
- PostgreSQL 16.x
- GitHub account with appropriate permissions
- Sentry account with API access

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/debugmaster.git
cd debugmaster
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```
Edit `.env` with your configuration:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/debugmaster
SENTRY_TOKEN=your_sentry_token
GITHUB_TOKEN=your_github_token
```

4. Initialize the database:
```bash
npm run db:push
npm run db:seed
```

### Development

Start the development server:
```bash
npm run dev:all
```

This will start both the frontend and backend servers:
- Frontend: http://localhost:5173
- Backend: http://localhost:5000

### Production Deployment

Build the application:
```bash
npm run build
```

Start the production server:
```bash
npm run start
```

## 🛠️ Architecture

### Frontend
- React with TypeScript
- TailwindCSS for styling
- Shadcn UI components
- ReactFlow for knowledge graph visualization

### Backend
- Node.js with Express
- TypeScript
- PostgreSQL database
- Neo4j for knowledge graph storage
- Sentry integration for error tracking
- GitHub API integration

### AI Integration
- Google's Generative AI for bug analysis
- Custom prompt engineering for accurate fixes
- Rate limiting and error handling
- Fallback mechanisms for edge cases

## 📊 Monitoring

The application includes comprehensive monitoring:
- Issue processing metrics
- Fix success rates
- Processing times
- Error rates and types
- API usage statistics

## 🔒 Security

- Secure token handling for GitHub and Sentry APIs
- Input validation and sanitization
- Rate limiting to prevent abuse
- Code validation before PR creation

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Sentry for error tracking
- GitHub for repository management
- Google's Generative AI for intelligent analysis
- The open-source community for various tools and libraries

## 📞 Support

For support, please open an issue in the GitHub repository or contact the maintainers. 
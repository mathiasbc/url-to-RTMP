# Cloud Deployment Guide for URL-to-RTMP

This guide provides step-by-step instructions for deploying the URL-to-RTMP streamer to various cloud platforms. The project is packaged in a Docker container, so it can run on any service that supports Docker images.

**Key Requirement:** Before deploying, make sure you have your stream provider's RTMP URL and Stream Key. You will need to set these as environment variables on your chosen cloud platform.

## Table of Contents

-   [Railway](#railway)
-   [Render](#render)
-   [Heroku](#heroku)
-   [General Docker Deployment (DigitalOcean, AWS, GCP)](#general-docker-deployment-digitalocean-aws-gcp)

---

## Railway

Railway is a great choice for this project as it builds the Docker image for you automatically. The `railway.toml` file in this repository configures the deployment settings.

1.  **Install the Railway CLI:**
    Follow the official instructions to install the [Railway CLI](https://docs.railway.app/cli/installation).

2.  **Login to your Railway account:**
    ```bash
    railway login
    ```

3.  **Initialize and deploy the project:**
    Navigate to the project directory and run:
    ```bash
    railway up
    ```
    This command will create a new project, build the `Dockerfile`, deploy it, and provide you with a public URL for the API.

4.  **Set Environment Variables:**
    -   Go to your project's dashboard on Railway.
    -   Click on the "Variables" tab.
    -   Add the following variables:
        -   `TARGET_URL`: The web page you want to stream.
        -   `YOUTUBE_RTMP_URL`: Your RTMP ingest URL.
        -   `YOUTUBE_STREAM_KEY`: Your secret stream key.
        -   `ACCESS_KEYWORD`: A password to protect the API.
        -   (Optional) `STREAM_WIDTH`, `STREAM_HEIGHT`, `STREAM_FPS`, `STREAM_BITRATE`.
        -   (Optional) Set `AUTO_START` to `true` if you want the stream to begin immediately after deployment.

5.  **Start the Stream:**
    Once deployed and configured, send a POST request to the `/start` endpoint of your new Railway service URL.

---

## Render

Render can also automatically build and deploy from your `Dockerfile`. The `render.yaml` file defines the service.

1.  **Create a Render Account:**
    Sign up at [render.com](https://render.com).

2.  **Create a New Web Service:**
    -   From your dashboard, click "New" -> "Web Service".
    -   Connect your GitHub account and select this repository.
    -   Render will automatically detect the `render.yaml` and configure the settings. Give your service a unique name.

3.  **Set Environment Variables:**
    -   In the service settings, go to the "Environment" tab.
    -   Add your environment variables (`TARGET_URL`, `YOUTUBE_RTMP_URL`, `YOUTUBE_STREAM_KEY`, `ACCESS_KEYWORD`, etc.).
    -   **Important:** For your `YOUTUBE_STREAM_KEY` and `ACCESS_KEYWORD`, make sure to add them as "Secret Files" or secure variables if Render provides that option.

4.  **Deploy:**
    -   Click "Create Web Service". Render will pull the code, build the `Dockerfile`, and deploy your application.

5.  **Start the Stream:**
    Use the public URL provided by Render to access the API and start the stream.

---

## Heroku

Deploying to Heroku requires pushing the Docker image to the Heroku Container Registry.

1.  **Install Heroku CLI and Login:**
    Install the [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) and log in:
    ```bash
    heroku login
    ```

2.  **Create a Heroku App:**
    ```bash
    heroku create your-app-name
    ```

3.  **Set Environment Variables:**
    Go to your app's dashboard on Heroku -> "Settings" -> "Config Vars". Add your variables there.
    ```bash
    heroku config:set TARGET_URL="..."
    heroku config:set YOUTUBE_RTMP_URL="..."
    heroku config:set YOUTUBE_STREAM_KEY="..."
    heroku config:set ACCESS_KEYWORD="..."
    # ... and so on for other variables
    ```

4.  **Login to the Heroku Container Registry:**
    ```bash
    heroku container:login
    ```

5.  **Build and Push the Docker Image:**
    In the project directory, run the following commands to build the image and push it to Heroku. Replace `your-app-name` with the name of your Heroku app.
    ```bash
    # Tag for the 'web' process type
    docker build -t registry.heroku.com/your-app-name/web .
    
    # Push the image
    docker push registry.heroku.com/your-app-name/web
    ```

6.  **Release the Image:**
    This command makes the pushed container the active one for your app.
    ```bash
    heroku container:release web --app your-app-name
    ```

7.  **Start the Stream:**
    Use your Heroku app's URL (`https://your-app-name.herokuapp.com`) to make API calls.

---

## General Docker Deployment (DigitalOcean, AWS, GCP)

For any cloud provider that supports running Docker containers (like DigitalOcean App Platform, AWS App Runner, or Google Cloud Run), the process is generally similar.

1.  **Build and Push the Docker Image to a Registry:**
    You first need to build the Docker image and push it to a container registry that your cloud provider can access.
    -   **Docker Hub (Public):**
        ```bash
        docker build -t your-docker-username/url-to-rtmp:latest .
        docker push your-docker-username/url-to-rtmp:latest
        ```
    -   **Provider-Specific Registry:** Services like AWS (ECR), GCP (Artifact Registry), and DigitalOcean (Container Registry) have their own registries. Follow their instructions for pushing images.

2.  **Create a New Service:**
    -   In your cloud provider's dashboard, create a new application or service.
    -   Point it to the Docker image you just pushed to the registry.

3.  **Configure the Service:**
    -   **Ports:** Expose the container's port (`3000` by default) so it can be reached publicly.
    -   **Environment Variables:** Find the section for environment variables and add your configuration (`TARGET_URL`, `YOUTUBE_RTMP_URL`, etc.). Use the provider's "secret management" service for sensitive keys.
    -   **CPU/Memory:** This application is CPU-intensive. Start with a moderate container size (e.g., 1 vCPU, 2 GB RAM) and monitor its performance. You may need to scale up if the stream is laggy.

4.  **Deploy and Start:**
    -   Finalize the service creation and deploy it.
    -   Once the service has a public URL, you can use the API to start the stream.

## 🔧 Environment Variables

**Required:**
```env
TARGET_URL=https://your-website-to-stream.com
YOUTUBE_RTMP_URL=rtmp://a.rtmp.youtube.com/live2/
YOUTUBE_STREAM_KEY=your-youtube-stream-key
```

**Optional:**
```env
ACCESS_KEYWORD=your-secret-password
STREAM_WIDTH=1920
STREAM_HEIGHT=1080
STREAM_FPS=30
STREAM_BITRATE=2500k
PORT=3000
HEADLESS=true
AUTO_START=false
```

## 🐳 Docker Deployment

### Build and Run Locally
```bash
# Build the image
docker build -t youtube-streamer .

# Run with environment file
docker run --env-file .env -p 3000:3000 youtube-streamer
```

### Docker Compose
```bash
# Copy env.example to .env and configure
cp env.example .env

# Start the service
docker-compose up -d
```

## 🌐 API Endpoints

- `GET /` - Service status and info
- `GET /status` - Current streaming status
- `POST /start` - Start streaming (requires keyword)
- `POST /stop` - Stop streaming (requires keyword)

### Example API Usage
```bash
# Check status
curl https://your-app.railway.app/status

# Start streaming
curl -X POST https://your-app.railway.app/start \
  -H "Content-Type: application/json" \
  -d '{"keyword": "your-secret-keyword"}'

# Stop streaming
curl -X POST https://your-app.railway.app/stop \
  -H "Content-Type: application/json" \
  -d '{"keyword": "your-secret-keyword"}'
```

## 🎯 YouTube Setup

1. **Go to YouTube Studio**
2. **Create a Live Stream:**
   - Click "Go Live"
   - Choose "Stream" method
   - Copy your Stream Key
3. **Configure Stream Settings:**
   - Set stream to 1920x1080 @ 30fps
   - Choose appropriate privacy settings
4. **Use the RTMP URL:** `rtmp://a.rtmp.youtube.com/live2/`

## 📊 Cloud Platform Comparison

| Platform | Docker Support | Auto-scaling | Free Tier | Best For |
|----------|---------------|--------------|-----------|----------|
| Railway | ✅ Excellent | ✅ Yes | ✅ $5/month | **Recommended** |
| Google Cloud Run | ✅ Native | ✅ Serverless | ✅ Generous | Serverless |
| DigitalOcean | ✅ Native | ✅ Yes | ❌ $5/month | Simple setup |
| AWS Fargate | ✅ Native | ✅ Yes | ❌ Pay-per-use | Enterprise |
| Heroku | ⚠️ Limited | ✅ Yes | ✅ Limited | Simple apps |

## 🔍 Troubleshooting

### Common Issues

**Browser fails to start:**
```bash
# Check if running in Docker with proper dependencies
# Ensure HEADLESS=true in cloud environments
```

**FFmpeg not found:**
```bash
# Dockerfile includes FFmpeg installation
# For local dev: brew install ffmpeg (macOS) or apt install ffmpeg (Ubuntu)
```

**Out of memory:**
```bash
# Increase container memory (2GB+ recommended)
# Reduce STREAM_WIDTH/STREAM_HEIGHT for lower resource usage
```

**Stream quality issues:**
```bash
# Adjust STREAM_BITRATE (lower for unstable connections)
# Reduce STREAM_FPS for better stability
```

## ⚡ Performance Optimization

### Resource Requirements
- **Minimum:** 1 CPU, 2GB RAM
- **Recommended:** 2 CPU, 4GB RAM
- **Network:** Stable upload (3+ Mbps for 2500k bitrate)

### Optimization Tips
1. **Use HEADLESS=true** in production
2. **Block unnecessary resources** (images, fonts) for faster loading
3. **Choose appropriate bitrate** based on upload speed
4. **Monitor memory usage** and restart if needed

## 🛡️ Security

- Use **ACCESS_KEYWORD** to protect streaming endpoints
- Keep **YOUTUBE_STREAM_KEY** secret
- Deploy with HTTPS enabled
- Consider IP whitelisting for production

## 📈 Monitoring

The service includes a health check endpoint and logs streaming status. Monitor:
- CPU and memory usage
- Network upload bandwidth
- FFmpeg process health
- Browser automation stability

---

**Need help?** Check the logs for detailed error messages and troubleshooting information. 
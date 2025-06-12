# URL to RTMP - Web Page to Live Stream

Stream any web page to YouTube Live, Twitch, or any other RTMP-compatible service. This project uses Playwright to capture a target web page in a headless browser and streams it 24/7 using FFmpeg. It's designed for reliable, long-running cloud deployment in a Docker container.

![Diagram](https://i.imgur.com/example.png) <!-- Placeholder: A diagram showing Web Page -> Playwright -> FFmpeg -> RTMP -->

## ✨ Features

- **🔴 Live Stream Any Web Page:** Capture and stream dynamic web content.
- **☁️ Cloud-Ready:** Optimized for 24/7 deployment on services like Railway, Render, Heroku, AWS, and GCP.
- **🐳 Dockerized:** Includes a production-ready `Dockerfile` with Playwright and FFmpeg pre-installed.
- **🚀 Remote Control API:** Start, stop, and check the stream status via a simple REST API.
- **🔐 Secure Access:** Protect API endpoints with an optional access keyword.
- **🔧 Highly Configurable:** Adjust resolution, FPS, and bitrate using environment variables.
- **🔇 Silent Audio Track:** Includes a synthetic silent audio track, a requirement for many streaming platforms like YouTube Live.
- **🔄 Auto-Restart:** (If configured) Can automatically restart the stream on container startup.

## ⚙️ How It Works

1.  **Koa Web Server:** A lightweight server starts and exposes API endpoints.
2.  **Playwright Browser:** When the `/start` endpoint is called, Playwright launches a headless Chromium browser.
3.  **Page Navigation:** It navigates to the `TARGET_URL` you provide.
4.  **Screenshot Loop:** The application takes screenshots of the page at the configured `STREAM_FPS`.
5.  **FFmpeg Pipe:** Each screenshot is piped directly to an FFmpeg process.
6.  **RTMP Streaming:** FFmpeg encodes the screenshots into a video stream (H.264) with a silent audio track (AAC) and sends it to your specified RTMP server.

## 🚀 Getting Started

### Prerequisites

-   Docker and Docker Compose
-   A YouTube, Twitch, or other account with RTMP stream details.

### Local Development

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/url-to-rtmp.git
    cd url-to-rtmp
    ```

2.  **Create an environment file:**
    Copy the `env.example` to a new file named `.env`.
    ```bash
    cp env.example .env
    ```

3.  **Configure your stream:**
    Edit the `.env` file with your details:
    -   `TARGET_URL`: The full URL of the web page you want to stream.
    -   `YOUTUBE_RTMP_URL`: The RTMP ingest URL from your streaming provider.
    -   `YOUTUBE_STREAM_KEY`: Your unique stream key.
    -   `ACCESS_KEYWORD`: A secret password to protect the API endpoints.

4.  **Build and run with Docker Compose:**
    ```bash
    docker-compose up --build
    ```
    The service will be running and available at `http://localhost:3000`.

5.  **Start the stream:**
    Use a tool like `curl` or Postman to send a POST request to the `/start` endpoint.
    ```bash
    curl -X POST http://localhost:3000/start \
         -H "Content-Type: application/json" \
         -d '{"keyword": "your-secret-keyword"}'
    ```

## 🔧 Configuration

All configuration is managed through environment variables, making it easy to deploy. See `env.example` for a full list of available options and detailed comments.

| Variable             | Description                                           | Default      |
| -------------------- | ----------------------------------------------------- | ------------ |
| `TARGET_URL`         | **Required.** The web page to stream.                 | -            |
| `YOUTUBE_RTMP_URL`   | **Required.** The RTMP ingest URL.                    | -            |
| `YOUTUBE_STREAM_KEY` | **Required.** Your stream key.                        | -            |
| `ACCESS_KEYWORD`     | A secret keyword to protect the API.                  | `""` (none)  |
| `STREAM_WIDTH`       | Stream width in pixels.                               | `1920`       |
| `STREAM_HEIGHT`      | Stream height in pixels.                              | `1080`       |
| `STREAM_FPS`         | Stream frames per second.                             | `30`         |
| `STREAM_BITRATE`     | Stream video bitrate (e.g., `7000k`).                 | `7000k`      |
| `PORT`               | The port for the API server.                          | `3000`       |
| `HEADLESS`           | Run browser in headless mode.                         | `true`       |
| `AUTO_START`         | Automatically start streaming on container launch.    | `false`      |

## API Endpoints

-   **`POST /start`**: Starts the web capture and RTMP stream.
-   **`POST /stop`**: Stops the stream and closes the browser.
-   **`GET /status`**: Gets the current status of the streamer.
-   **`GET /`**: A simple health check endpoint.

**Request Body for protected endpoints (`/start`, `/stop`):**
```json
{
  "keyword": "your-secret-keyword"
}
```

## ☁️ Deployment

This project is designed for easy deployment to any cloud provider that supports Docker containers. For detailed, step-by-step instructions for various platforms, please see the **[DEPLOYMENT.md](DEPLOYMENT.md)** file.

-   **[Railway](DEPLOYMENT.md#railway)**
-   **[Render](DEPLOYMENT.md#render)**
-   **[Heroku](DEPLOYMENT.md#heroku)**
-   **[DigitalOcean, AWS, GCP](DEPLOYMENT.md#general-docker-deployment-digitalocean-aws-gcp)**

## Troubleshooting

-   **"Bitrate is lower than recommended" warning:** Increase the `STREAM_BITRATE` to match your streaming provider's recommendation (e.g., `8000k` for YouTube 1080p).
-   **High CPU Usage:** The streaming process is CPU-intensive. If you experience performance issues, try lowering the `STREAM_WIDTH`/`STREAM_HEIGHT` to `1280`/`720` or reducing the `STREAM_FPS` to `24`.
-   **FFmpeg errors:** Ensure your `YOUTUBE_RTMP_URL` and `YOUTUBE_STREAM_KEY` are correct. The logs will print FFmpeg's output for debugging.

---

*This project is not affiliated with YouTube or any other streaming platform.*

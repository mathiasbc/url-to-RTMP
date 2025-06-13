# URL to RTMP - Web Page to Live Stream

Stream any web page to YouTube Live, Twitch, or any other RTMP-compatible service. This project uses Playwright to capture a target web page in a headless browser and streams it 24/7 using FFmpeg. It's designed for reliable, long-running cloud deployment in a Docker container.

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
| `SCREENSHOT_INTERVAL`| How often to capture screenshots (in seconds).        | `10`         |
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

This application is designed for flexible deployment. You can run it on modern Platform-as-a-Service (PaaS) providers or on your own Virtual Machine (VM) for more control and potentially lower cost for 24/7 operation.

### Option 1: Deploy to a Cloud Platform (PaaS)

For the easiest, most managed deployment experience, we recommend using a cloud platform that directly supports Docker containers. This approach minimizes infrastructure management.

➡️ **See our detailed [Cloud Deployment Guide](DEPLOYMENT.md) for instructions on:**
-   **Railway**
-   **Render**
-   **Heroku**
-   **Google Cloud Run, AWS App Runner**, and more.

### Option 2: Deploy to a Personal Server or VM (IaaS)

For 24/7 streaming, running the application on a dedicated Virtual Machine can be significantly more cost-effective. Below are the detailed steps for deploying to a **Google Compute Engine (GCE) VM**. This guide can be adapted for any Linux-based VM (e.g., from AWS, DigitalOcean, or a home server).

#### Deploying to Google Compute Engine (GCE)

**Estimated Cost:** A 24/7 `e2-medium` instance (2 vCPU, 4GB RAM) costs approximately **$25-30/month**.

**Architecture:** We will create a GCE instance that runs a startup script to install Docker and clone this repository. A `systemd` service will be configured to automatically run the streamer via Docker Compose and ensure it restarts on boot or if it fails.

##### Step 1: Create a Startup Script

This script will run once when the VM is first created to set up the environment. Create a file named `gce-startup-script.sh` on your local machine.

```bash
#!/bin/bash
# URL-to-RTMP GCE Startup Script - UPDATED
# This script is intended to be run as root by GCE. 'sudo' is included so commands
# can also be run manually by a user with sudo privileges.

# 1. Uninstall old conflicting Docker packages
for pkg in docker.io docker-doc docker-compose podman-docker containerd runc; do sudo apt-get remove -y $pkg; done

# 2. Set up Docker's official repository
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update

# 3. Install Docker Engine, CLI, and Compose plugin
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 4. Clone the application repository into /opt
# IMPORTANT: Replace with your repository URL
sudo git clone https://github.com/mathiasbc/url-to-RTMP.git /opt/url-to-rtmp

# 5. Create the systemd service file to manage the application
sudo tee /etc/systemd/system/url-to-rtmp.service > /dev/null <<EOF
[Unit]
Description=URL to RTMP Docker Compose Service
Requires=docker.service
After=docker.service

[Service]
Restart=always
RestartSec=10
WorkingDirectory=/opt/url-to-rtmp
# Use the Docker Compose V2 plugin (docker compose)
ExecStart=/usr/bin/docker compose up
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
EOF

# 6. Enable the service so it starts on boot
sudo systemctl enable url-to-rtmp.service

# Note: The service will not successfully start until the user creates the .env file.
```

##### Step 2: Create and Configure the GCE VM

Run the following `gcloud` command from your local terminal to create the VM instance.

```bash
gcloud compute instances create url-to-rtmp-vm \
    --project=YOUR_GCP_PROJECT_ID \
    --zone=us-central1-a \
    --machine-type=e2-medium \
    --image-family=debian-11 \
    --image-project=debian-cloud \
    --boot-disk-size=20GB \
    --tags=http-server \
    --metadata-from-file=startup-script=./gce-startup-script.sh
```
-   Replace `YOUR_GCP_PROJECT_ID` with your project ID.
-   This command creates a VM, attaches our startup script, and tags it for HTTP traffic.

##### Step 3: Performance Tuning for Demanding Pages

The default `e2-medium` machine type is cost-effective, but it may not be powerful enough for complex, frequently updating web pages (e.g., live charts, dashboards). If you experience low frame rates (check the logs) or your stream is buffering, you have three options:

1.  **Upgrade the VM Instance (Recommended for high quality):**
    For a smoother 1080p @ 30fps stream on demanding sites, use a more powerful machine. A `n1-standard-2` (2 vCPU, 7.5GB RAM) or even a `n1-standard-4` (4 vCPU, 15GB RAM) is a good choice. To use it, simply replace `--machine-type=e2-medium` with `--machine-type=n1-standard-2` in the `gcloud` command above. This will increase the monthly cost.

2.  **Optimize for Slowly-Changing Content (Recommended for dashboards):**
    If your target page updates infrequently (like the Bitcoin dashboard that updates every 60 seconds), you can dramatically reduce CPU usage by increasing the screenshot interval. Edit the `.env` file on your VM (`sudo nano /opt/url-to-rtmp/.env`) and add:
    -   `SCREENSHOT_INTERVAL=30` (takes a screenshot every 30 seconds)
    -   Or even `SCREENSHOT_INTERVAL=60` for very static content
    
    FFmpeg will automatically duplicate frames to maintain smooth 30fps video output while using much less CPU.

3.  **Lower the Stream Quality (Most economical):**
    If you want to keep costs down, you can reduce the CPU load by lowering the stream quality. You can do this by editing the `.env` file on your VM (`sudo nano /opt/url-to-rtmp/.env`) and changing these values:
    -   `STREAM_WIDTH=1280`
    -   `STREAM_HEIGHT=720`
    -   `STREAM_FPS=20` (or even 15)
    -   `STREAM_BITRATE=4000k`

After editing the `.env` file, restart the service with `sudo systemctl restart url-to-rtmp`.

##### Step 4: Set Up Firewall Rule

Allow external traffic to reach the API server on port `3000`.
```bash
gcloud compute firewall-rules create allow-streamer-api \
    --allow tcp:3000 \
    --source-ranges=0.0.0.0/0 \
    --target-tags=http-server
```

##### Step 5: Configure and Start the Streamer

1.  **SSH into your new VM:**
    ```bash
    gcloud compute ssh url-to-rtmp-vm --zone=us-central1-a
    ```

2.  **Create your environment file:**
    The repository was cloned to `/opt/url-to-rtmp`. Navigate there and create your `.env` file.
    ```bash
    cd /opt/url-to-rtmp
    sudo cp env.example .env
    sudo nano .env
    ```
    Fill in your `TARGET_URL`, `YOUTUBE_RTMP_URL`, `YOUTUBE_STREAM_KEY`, and `ACCESS_KEYWORD`. Save the file (`Ctrl+X`, `Y`, `Enter`).

3.  **Start the service:**
    The `systemd` service is already enabled but may have failed because the `.env` file was missing. Now you can start it manually.
    ```bash
    sudo systemctl start url-to-rtmp
    ```

##### Step 6: Manage and Monitor the Service

-   **Check Status:** See if the service is running correctly.
    ```bash
    sudo systemctl status url-to-rtmp
    ```
-   **View Logs:** Watch the real-time output of your Docker container.
    ```bash
    sudo journalctl -fu url-to-rtmp.service
    ```
-   **Restarting:**
    ```bash
    sudo systemctl restart url-to-rtmp
    ```

Your service is now deployed and will run 24/7, automatically restarting if the VM reboots or the process crashes.

## Troubleshooting

-   **"Bitrate is lower than recommended" warning:** Increase the `STREAM_BITRATE` to match your streaming provider's recommendation (e.g., `8000k` for YouTube 1080p).
-   **High CPU Usage:** The streaming process is CPU-intensive. If you experience performance issues, try:
    -   Increasing `SCREENSHOT_INTERVAL` to `30` or `60` seconds for slowly-changing content (like dashboards)
    -   Lowering the `STREAM_WIDTH`/`STREAM_HEIGHT` to `1280`/`720`
    -   Reducing the `STREAM_FPS` to `24`
-   **FFmpeg errors:** Ensure your `YOUTUBE_RTMP_URL` and `YOUTUBE_STREAM_KEY` are correct. The logs will print FFmpeg's output for debugging.

---

*This project is not affiliated with YouTube or any other streaming platform.*

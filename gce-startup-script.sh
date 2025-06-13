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

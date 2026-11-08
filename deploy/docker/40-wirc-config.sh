#!/bin/sh
set -eu

# Runtime client config.
cat > /usr/share/nginx/html/config.json <<JSON
{ "server": { "url": "${WIRC_SERVER_URL:-}", "autoconnect": false }, "source": "${WIRC_SOURCE_URL:-}" }
JSON

# Optional reverse proxy to soju (same-origin, so soju's default origin check passes).
if [ -n "${SOJU_UPSTREAM:-}" ]; then
  cat > /etc/nginx/wirc-proxy.conf <<CONF
location /socket {
  proxy_pass http://${SOJU_UPSTREAM};
  proxy_http_version 1.1;
  proxy_set_header Upgrade \$http_upgrade;
  proxy_set_header Connection \$connection_upgrade;
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header Sec-WebSocket-Extensions "";
  proxy_read_timeout 1d;
  proxy_send_timeout 1d;
}
location /uploads {
  proxy_pass http://${SOJU_UPSTREAM};
  proxy_set_header Host \$host;
  client_max_body_size 50m;
}
CONF
else
  : > /etc/nginx/wirc-proxy.conf
fi

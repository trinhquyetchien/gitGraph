FROM node:20-alpine

# Cài đặt git và openssh trên môi trường Alpine Linux
RUN apk add --no-cache git openssh-client

WORKDIR /app

# Copy toàn bộ mã nguồn ứng dụng
COPY package.json ./
COPY server.mjs ./
COPY public ./public
COPY README.md ./

# Cổng mặc định
ENV PORT=4173
ENV HOST=0.0.0.0

EXPOSE 4173

# Khởi chạy GitGraph server
CMD ["node", "server.mjs"]

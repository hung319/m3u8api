# 1. Base image
FROM node:20-slim

# 2. Set working directory
WORKDIR /usr/src/app

# 3. Copy package.json và package-lock.json (nếu có)
COPY package*.json ./

# 4. Cài đặt dependencies
RUN npm install

# 5. Copy toàn bộ source code vào image
COPY . .

# 6. Expose port server (3000)
EXPOSE 3000

# 7. Command chạy app
CMD ["node", "index.js"]

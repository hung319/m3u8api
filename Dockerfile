# 1. Chọn base image
FROM node:20

# 2. Tạo thư mục app
WORKDIR /usr/src/app

# 3. Copy source code
COPY package*.json ./
COPY index.js .

# 4. Cài đặt các thư viện cần thiết
RUN npm install

# 5. Mở cổng server
EXPOSE 3000

# 6. Lệnh để start server
CMD ["node", "index.js"]

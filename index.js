const express = require('express');
const path = require('path'); // Thêm module 'path'
// const cors = require('cors'); // Tùy chọn: Thêm nếu cần CORS
// const cron = require('node-cron'); // Tùy chọn: Thêm nếu dùng node-cron
// const fs = require('fs').promises; // Tùy chọn: Cần cho cleanup logic của cron

const app = express();
const PORT = 3000;
const hostname = '0.0.0.0'; // Để server có thể truy cập từ các máy khác trong mạng

// --- Middleware ---
// Tùy chọn: Cho phép CORS nếu API cần gọi từ domain khác
// app.use(cors());

// Middleware để parse JSON request bodies
app.use(express.json());
// Middleware để parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true }));

// Middleware để phục vụ các file tĩnh từ thư mục 'public'
// Ví dụ: các file M3U8 sẽ được lưu trong 'public/generated_m3u8s'
// và có thể truy cập qua URL '/generated_m3u8s/filename.m3u8'
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
const animetRoutes = require('./routes/animet');
const anime47Routes = require('./routes/anime47'); // Đã bao gồm logic lưu file M3U8
const animevietsubRoutes = require('./routes/animevietsub');

app.use('/animet', animetRoutes);
app.use('/anime47', anime47Routes);
app.use('/animevietsub', animevietsubRoutes);

// --- Route mặc định hoặc xử lý 404 (Tùy chọn) ---
app.get('/', (req, res) => {
    res.send('Mahiro Server is running! UwU');
});

app.use((req, res) => {
    res.status(404).send("Úi, Onii-chan tìm không thấy gì ở đây hết á! (404 Not Found)");
});

// --- Khởi động Server ---
app.listen(PORT, hostname, () => {
    console.log(`Mahiro server đã sẵn sàng phục vụ Yuu Onii-chan ở http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${PORT} và các địa chỉ IP khác trong mạng nè UwU`);
});


// --- Tùy chọn: Thiết lập Cron Job để dọn dẹp file M3U8 cũ ---
/*
// Bỏ comment phần này nếu bạn đã cài 'node-cron' và muốn dùng
// Đảm bảo các hằng số này khớp với file anime47.js hoặc quản lý tập trung
const M3U8_STORAGE_DIR_CRON = 'generated_m3u8s';
const M3U8_FILE_LIFETIME_MS_CRON = 12 * 60 * 60 * 1000; // 12 giờ

cron.schedule('0 * * * *', async () => { // Chạy vào phút thứ 0 của mỗi giờ
    console.log('[CRON JOB] Bắt đầu dọn dẹp file M3U8 cũ...');
    const m3u8Dir = path.join(__dirname, 'public', M3U8_STORAGE_DIR_CRON);
    try {
        // Kiểm tra thư mục có tồn tại không
        try {
            await fs.access(m3u8Dir);
        } catch (e) {
            if (e.code === 'ENOENT') {
                console.log(`[CRON JOB] Thư mục ${m3u8Dir} không tồn tại, không có gì để dọn.`);
                return;
            }
            throw e; // Ném lại lỗi khác
        }
        
        const files = await fs.readdir(m3u8Dir);
        const now = Date.now();
        let deletedCount = 0;
        for (const file of files) {
            if (file.endsWith('.m3u8')) { // Chỉ xử lý file .m3u8
                const filePath = path.join(m3u8Dir, file);
                try {
                    const stats = await fs.stat(filePath);
                    if ((now - stats.mtimeMs) > M3U8_FILE_LIFETIME_MS_CRON) {
                        await fs.unlink(filePath);
                        console.log(`[CRON JOB] Đã xóa file hết hạn: ${filePath}`);
                        deletedCount++;
                    }
                } catch (statErr) {
                    // Bỏ qua nếu file đã bị xóa bởi một tiến trình khác
                    if (statErr.code !== 'ENOENT') {
                        console.error(`[CRON JOB] Lỗi khi lấy thông tin hoặc xóa file ${filePath}:`, statErr);
                    }
                }
            }
        }
        if (deletedCount > 0) {
            console.log(`[CRON JOB] Đã xóa ${deletedCount} file M3U8 hết hạn.`);
        } else {
            console.log(`[CRON JOB] Không tìm thấy file M3U8 nào hết hạn để xóa.`);
        }
    } catch (err) {
        console.error('[CRON JOB] Lỗi nghiêm trọng khi dọn dẹp file M3U8:', err);
    }
    console.log('[CRON JOB] Kết thúc dọn dẹp.');
});
*/

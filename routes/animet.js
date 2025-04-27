const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const router = express.Router();

router.get('/get-m3u8', async (req, res) => {
    const { filmid, epid } = req.query;

    if (!filmid || !epid) {
        return res.status(400).send('Thiếu filmid hoặc epid rồi đó Yuu Onii-chan~');
    }

    try {
        const url = `https://animet.org/phim/${filmid}/${epid}`;
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        const mainSiteLink = $('span.text-success.font-weight-bold').closest('a').attr('href');

        if (!mainSiteLink) {
            return res.status(404).send('Không tìm thấy link anime6.Site đâu Yuu Onii-chan~');
        }

        const anime6Response = await axios.get(mainSiteLink);
        const anime6Html = anime6Response.data;
        const $2 = cheerio.load(anime6Html);

        const iframeSrc = $2('iframe').attr('src');

        if (!iframeSrc) {
            return res.status(404).send('Không tìm thấy iframe đâu Yuu Onii-chan~');
        }

        const finalResponse = await axios.get(iframeSrc);
        const finalHtml = finalResponse.data;
        const $3 = cheerio.load(finalHtml);

        const scriptContent = $3('script').html() || '';
        const regex = /(https?:\/\/.*?\.m3u8)/;
        const match = scriptContent.match(regex);

        if (match && match[1]) {
            const m3u8Link = match[1];
            res.setHeader('Content-Type', 'text/plain');
            return res.send(m3u8Link);
        } else {
            return res.status(404).send('Không tìm thấy link m3u8 đâu Yuu Onii-chan~');
        }
    } catch (error) {
        console.error(error);
        return res.status(500).send('Có lỗi rồi Yuu Onii-chan... gomenasai~');
    }
});

module.exports = router;

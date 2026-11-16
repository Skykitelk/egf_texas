/**
 * 图片下载模块
 * 从蓝湖设计稿中下载图片资源到 Cocos Creator 项目目录
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_OUTPUT_DIR = 'assets/resources/textures/generated';
const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

class ImageDownloader {
  /**
   * @param {string} projectPath - Cocos Creator 项目根目录
   */
  constructor(projectPath, outputDir) {
    this.projectPath = projectPath || process.cwd();
    this.outputDir = path.join(this.projectPath, outputDir || DEFAULT_OUTPUT_DIR);
  }

  /**
   * 下载单张图片，支持重试
   * @param {string} url - 图片 URL
   * @param {string} fileName - 保存的文件名（不含扩展名时自动从 URL 提取）
   * @returns {Promise<string>} 本地文件路径
   */
  async downloadImage(url, fileName) {
    const ext = this._extractExtension(url);
    const safeName = this._sanitizeFileName(fileName);
    const finalName = safeName.includes('.') ? safeName : `${safeName}${ext}`;
    const localPath = path.join(this.outputDir, finalName);

    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this._download(url, localPath);
        return localPath;
      } catch (error) {
        lastError = error;
        console.warn(`[downloader] 下载失败 (${attempt}/${MAX_RETRIES}): ${fileName} - ${error.message}`);
        if (attempt < MAX_RETRIES) {
          await this._sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw new Error(`下载失败，已重试 ${MAX_RETRIES} 次: ${fileName} (${url}) - ${lastError.message}`);
  }

  /**
   * 批量下载图片，返回 { [elementName]: localPath } 映射
   * @param {Array<{name: string, url: string}>} imageList - 图片列表
   * @returns {Promise<Object>} 下载结果映射
   */
  async downloadAll(imageList) {
    if (!imageList || imageList.length === 0) {
      return {};
    }

    const results = {};
    const errors = [];

    // 将列表分成并发批次处理
    const queue = [...imageList];
    const executing = new Set();

    const enqueue = async (item) => {
      const promise = this._downloadItem(item)
        .then(localPath => {
          results[item.name] = localPath;
          console.log(`[downloader] 完成: ${item.name} -> ${localPath}`);
        })
        .catch(err => {
          errors.push({ name: item.name, url: item.url, error: err.message });
          console.error(`[downloader] 失败: ${item.name} - ${err.message}`);
        })
        .finally(() => {
          executing.delete(promise);
        });

      executing.add(promise);

      // 达到并发上限时等待任意一个完成
      if (executing.size >= MAX_CONCURRENCY) {
        await Promise.race(executing);
      }
    };

    for (const item of queue) {
      await enqueue(item);
    }

    // 等待所有剩余任务完成
    await Promise.all(executing);

    if (errors.length > 0) {
      console.warn(`[downloader] ${errors.length} 个图片下载失败:`, errors);
    }

    console.log(`[downloader] 下载完成: ${Object.keys(results).length}/${imageList.length} 成功`);
    return results;
  }

  /**
   * 下载单个列表项
   * @private
   */
  async _downloadItem(item) {
    const fileName = item.name || this._extractFileName(item.url);
    return this.downloadImage(item.url, fileName);
  }

  /**
   * 执行 HTTP/HTTPS 下载，支持重定向（最多 5 次）
   * @private
   */
  _download(url, destPath, redirectCount = 0) {
    if (redirectCount > 5) {
      return Promise.reject(new Error('重定向次数过多'));
    }

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const request = client.get(url, (response) => {
        const { statusCode } = response;

        // 处理重定向
        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          response.resume(); // 释放内存
          const redirectUrl = new URL(response.headers.location, url).href;
          this._download(redirectUrl, destPath, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(destPath);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (err) => {
          // 清理失败的文件
          fs.unlink(destPath, () => {});
          reject(err);
        });

        response.pipe(fileStream);
      });

      request.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });

      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('请求超时'));
      });
    });
  }

  /**
   * 从 URL 提取文件扩展名
   * @private
   */
  _extractExtension(url) {
    try {
      const pathname = new URL(url).pathname;
      const ext = path.extname(pathname);
      return ext || '.png';
    } catch {
      return '.png';
    }
  }

  /**
   * 从 URL 提取文件名
   * @private
   */
  _extractFileName(url) {
    try {
      const pathname = new URL(url).pathname;
      return path.basename(pathname) || 'image.png';
    } catch {
      return 'image.png';
    }
  }

  /**
   * 清理文件名，去除不安全字符
   * @private
   */
  _sanitizeFileName(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  }

  /**
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { ImageDownloader };

import { request } from '../../utils/request';

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const RATIO = A4_HEIGHT_MM / A4_WIDTH_MM;

Page({
  data: {
    canvasWidth: 300,
    canvasHeight: 424,
    records: [] as any[],
    tempFilePath: '' as string,
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync();
    const screenWidth = sysInfo.windowWidth;
    const canvasWidth = screenWidth - 32; // 16px padding each side
    const canvasHeight = canvasWidth * RATIO;
    
    this.setData({
      canvasWidth,
      canvasHeight
    });

    this.loadData();
  },

  async loadData() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;

    wx.showLoading({ title: '准备数据...' });

    try {
      const res = await request<{ data: any[] }>({
        url: `/records?openid=${openid}`,
        method: 'GET'
      });

      // Filter last 30 days
      const now = new Date();
      const startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).getTime();
      
      const records = res.data
        .filter(r => new Date(r.measured_at).getTime() >= startTime)
        .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime());

      const processedData = this.processRecords(records);
      this.drawTable(processedData);

    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  processRecords(records: any[]) {
    const grouped: { [key: string]: { morning: any[], noon: any[], evening: any[] } } = {};
    
    // Initialize last 30 days keys to ensure continuous dates
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
      grouped[dateStr] = { morning: [], noon: [], evening: [] };
    }

    records.forEach(r => {
      const d = new Date(r.measured_at);
      const dateStr = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
      const hour = d.getHours();

      if (grouped[dateStr]) {
        if (hour >= 4 && hour < 11) {
          grouped[dateStr].morning.push(r);
        } else if (hour >= 11 && hour < 16) {
          grouped[dateStr].noon.push(r);
        } else if (hour >= 16) {
          grouped[dateStr].evening.push(r);
        }
      }
    });

    // Calculate averages
    const result = Object.keys(grouped).sort().map(date => {
      const dayData = grouped[date];
      const calcAvg = (arr: any[]) => {
        if (arr.length === 0) return null;
        const sys = Math.round(arr.reduce((acc, cur) => acc + cur.systolic, 0) / arr.length);
        const dia = Math.round(arr.reduce((acc, cur) => acc + cur.diastolic, 0) / arr.length);
        const hr = Math.round(arr.reduce((acc, cur) => acc + (cur.heart_rate || 0), 0) / arr.length);
        return { sys, dia, hr };
      };

      return {
        date,
        morning: calcAvg(dayData.morning),
        noon: calcAvg(dayData.noon),
        evening: calcAvg(dayData.evening)
      };
    });

    return result;
  },

  drawTable(data: any[]) {
    const query = wx.createSelectorQuery();
    query.select('#a4Canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return;
        
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio;
        const scaleFactor = 3; // Increase resolution for printing
        
        const width = res[0].width;
        const height = res[0].height;
        
        canvas.width = width * dpr * scaleFactor;
        canvas.height = height * dpr * scaleFactor;
        ctx.scale(dpr * scaleFactor, dpr * scaleFactor);

        // White background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        // Margins
        const marginX = 20;
        const marginY = 30;
        const contentWidth = width - marginX * 2;
        const contentHeight = height - marginY * 2;

        // Title
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('血压记录表', width / 2, marginY + 10);

        // Table Header
        const tableTop = marginY + 40;
        const rowHeight = (contentHeight - 60) / (data.length + 2); // +2 for header rows
        
        // Column widths
        // Date: 20%, Morning: 26%, Noon: 26%, Evening: 26%
        // Subcols: 3 each
        const colDateW = contentWidth * 0.16;
        const colSectionW = (contentWidth - colDateW) / 3;
        const colItemW = colSectionW / 3;

        ctx.lineWidth = 1;
        ctx.strokeStyle = '#000000';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Draw Header Row 1 (Date, Morning, Noon, Evening)
        let currentX = marginX;
        const headerY1 = tableTop;
        const headerY2 = tableTop + rowHeight;
        
        // Date Box
        ctx.strokeRect(currentX, headerY1, colDateW, rowHeight * 2);
        ctx.fillText('日期', currentX + colDateW/2, headerY1 + rowHeight);
        currentX += colDateW;

        // Sections
        ['早上', '中午', '晚上'].forEach(section => {
          ctx.strokeRect(currentX, headerY1, colSectionW, rowHeight);
          ctx.fillText(section, currentX + colSectionW/2, headerY1 + rowHeight/2);
          
          // Sub headers
          ['收缩', '舒张', '心率'].forEach((sub, idx) => {
            ctx.strokeRect(currentX + idx * colItemW, headerY2, colItemW, rowHeight);
            ctx.fillText(sub, currentX + idx * colItemW + colItemW/2, headerY2 + rowHeight/2);
          });
          
          currentX += colSectionW;
        });

        // Draw Data Rows
        let currentY = headerY2 + rowHeight;
        
        data.forEach(row => {
          currentX = marginX;
          
          // Date
          ctx.strokeRect(currentX, currentY, colDateW, rowHeight);
          // Format date: MM-DD
          const dateObj = new Date(row.date);
          const dateStr = `${dateObj.getMonth()+1}-${dateObj.getDate()}`;
          ctx.fillText(dateStr, currentX + colDateW/2, currentY + rowHeight/2);
          currentX += colDateW;

          // Data
          [row.morning, row.noon, row.evening].forEach(item => {
            if (item) {
              // Sys
              ctx.strokeRect(currentX, currentY, colItemW, rowHeight);
              ctx.fillText(item.sys.toString(), currentX + colItemW/2, currentY + rowHeight/2);
              
              // Dia
              ctx.strokeRect(currentX + colItemW, currentY, colItemW, rowHeight);
              ctx.fillText(item.dia.toString(), currentX + colItemW * 1.5, currentY + rowHeight/2);
              
              // HR
              ctx.strokeRect(currentX + colItemW * 2, currentY, colItemW, rowHeight);
              ctx.fillText(item.hr.toString(), currentX + colItemW * 2.5, currentY + rowHeight/2);
            } else {
              // Empty cells
              ctx.strokeRect(currentX, currentY, colItemW, rowHeight);
              ctx.strokeRect(currentX + colItemW, currentY, colItemW, rowHeight);
              ctx.strokeRect(currentX + colItemW * 2, currentY, colItemW, rowHeight);
            }
            currentX += colSectionW;
          });

          currentY += rowHeight;
        });
        
        // Footer
        ctx.textAlign = 'right';
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#999999';
        ctx.fillText('由「安压宝」生成', width - marginX, height - 10);
      });
  },

  onSaveImage() {
    this.getCanvasTempFile().then(filePath => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => {
          wx.showToast({ title: '已保存到相册', icon: 'success' });
        },
        fail: (err) => {
          if (err.errMsg.includes('auth')) {
            wx.showModal({
              title: '提示',
              content: '需要您授权保存图片到相册',
              success: (modalRes) => {
                if (modalRes.confirm) wx.openSetting();
              }
            });
          }
        }
      });
    });
  },

  onShareImage() {
    this.getCanvasTempFile().then(filePath => {
      wx.shareFileMessage({
        filePath,
        fileName: '血压记录表.jpg',
        success: () => {
          console.log('分享成功');
        },
        fail: (err) => {
          console.error('分享失败', err);
          // 如果不支持 shareFileMessage，尝试预览
          wx.previewImage({
            urls: [filePath],
            current: filePath
          });
        }
      });
    });
  },

  onPrint() {
    this.getCanvasTempFile().then(filePath => {
      // 微信小程序没有直接打印API，引导用户保存后打印
      wx.showModal({
        title: '打印说明',
        content: '请先保存图片到相册，然后使用手机相册的"打印"功能，或将图片发送到电脑打印。',
        confirmText: '保存图片',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            wx.saveImageToPhotosAlbum({
              filePath,
              success: () => {
                wx.showToast({ title: '已保存，请前往相册打印', icon: 'none', duration: 2000 });
              },
              fail: (err) => {
                if (err.errMsg.includes('auth')) {
                  wx.showModal({
                    title: '提示',
                    content: '需要您授权保存图片到相册',
                    success: (modalRes) => {
                      if (modalRes.confirm) wx.openSetting();
                    }
                  });
                }
              }
            });
          }
        }
      });
    });
  },

  getCanvasTempFile(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.data.tempFilePath) {
        resolve(this.data.tempFilePath);
        return;
      }

      const query = wx.createSelectorQuery();
      query.select('#a4Canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res[0].node;
          wx.canvasToTempFilePath({
            canvas,
            fileType: 'jpg',
            quality: 1,
            success: (result) => {
              this.setData({ tempFilePath: result.tempFilePath });
              resolve(result.tempFilePath);
            },
            fail: reject
          });
        });
    });
  }
});

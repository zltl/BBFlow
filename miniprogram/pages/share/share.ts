import { request } from '../../utils/request';

Page({
  data: {
    timeRange: '7', // '7' or '30'
    userInfo: null as any,
    stats: {
      avgSys: 0,
      avgDia: 0,
      avgHr: 0,
      maxSys: 0,
      minSys: 0,
      abnormalCount: 0,
      totalCount: 0,
      interpretation: ''
    },
    canvasWidth: 300,
    canvasHeight: 550,
    isGenerating: false
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({ userInfo });
    }
    this.loadData();
  },

  onRangeChange(e: WechatMiniprogram.TouchEvent) {
    const range = e.currentTarget.dataset.range;
    if (range !== this.data.timeRange) {
      this.setData({ timeRange: range }, () => {
        this.loadData();
      });
    }
  },

  async loadData() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;

    wx.showLoading({ title: '加载数据...' });

    try {
      const res = await request<{ data: any[] }>({
        url: `/records?openid=${openid}`,
        method: 'GET'
      });

      const now = new Date();
      const days = parseInt(this.data.timeRange);
      const startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).getTime();

      const records = res.data
        .filter(r => new Date(r.measured_at).getTime() >= startTime)
        .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime());

      this.calculateStats(records);
      this.drawShareImage(records);

    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  calculateStats(records: any[]) {
    if (records.length === 0) {
      this.setData({
        stats: { avgSys: 0, avgDia: 0, avgHr: 0, maxSys: 0, minSys: 0, abnormalCount: 0, totalCount: 0, interpretation: '' }
      });
      return;
    }

    const sysSum = records.reduce((acc, r) => acc + r.systolic, 0);
    const diaSum = records.reduce((acc, r) => acc + r.diastolic, 0);
    // Use heart_rate (DB column name) instead of heartRate
    const hrSum = records.reduce((acc, r) => acc + (r.heart_rate || 0), 0);
    const hrCount = records.filter(r => r.heart_rate).length;
    const sysValues = records.map(r => r.systolic);
    
    let level1 = 0; // 140-159 / 90-99
    let level2 = 0; // 160-179 / 100-109
    let level3 = 0; // >=180 / >=110
    
    records.forEach(r => {
      const s = r.systolic;
      const d = r.diastolic;
      if (s >= 180 || d >= 110) {
        level3++;
      } else if (s >= 160 || d >= 100) {
        level2++;
      } else if (s >= 140 || d >= 90) {
        level1++;
      }
    });

    const abnormalCount = level1 + level2 + level3;
    let interpretation = '';
    if (abnormalCount > 0) {
      const parts = [];
      if (level3 > 0) parts.push(`${level3}次三级`);
      if (level2 > 0) parts.push(`${level2}次二级`);
      if (level1 > 0) parts.push(`${level1}次一级`);
      interpretation = `其中 ${parts.join('，')}高血压`;
    } else {
      interpretation = '血压控制良好，请继续保持';
    }

    this.setData({
      stats: {
        avgSys: Math.round(sysSum / records.length),
        avgDia: Math.round(diaSum / records.length),
        avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : 0,
        maxSys: Math.max(...sysValues),
        minSys: Math.min(...sysValues),
        abnormalCount,
        totalCount: records.length,
        interpretation
      }
    });
  },

  drawShareImage(records: any[]) {
    const query = wx.createSelectorQuery();
    query.select('#shareCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return;
        
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio;
        
        const width = res[0].width;
        const height = res[0].height;
        
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Draw Background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        // Draw Header
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('安压宝 · 血压健康报告', width / 2, 40);

        // Draw Date Range
        const now = new Date();
        const days = parseInt(this.data.timeRange);
        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        const dateStr = `${startDate.getMonth()+1}.${startDate.getDate()} - ${now.getMonth()+1}.${now.getDate()}`;
        
        ctx.fillStyle = '#666666';
        ctx.font = '14px sans-serif';
        ctx.fillText(dateStr, width / 2, 70);

        // Draw Stats Grid (2x2)
        const statsY = 100;
        const colW = width / 2;
        const rowH = 60;
        
        // Row 1
        this.drawStatItem(ctx, '平均高压', this.data.stats.avgSys.toString(), 0 * colW + colW/2, statsY);
        this.drawStatItem(ctx, '平均低压', this.data.stats.avgDia.toString(), 1 * colW + colW/2, statsY);
        
        // Row 2
        this.drawStatItem(ctx, '平均心率', this.data.stats.avgHr ? this.data.stats.avgHr.toString() : '--', 0 * colW + colW/2, statsY + rowH);
        this.drawStatItem(ctx, '异常次数', this.data.stats.abnormalCount.toString(), 1 * colW + colW/2, statsY + rowH, '#ff4d4f');

        // Draw Chart Area
        const chartY = 230;
        const chartHeight = 200;
        const padding = 20;
        
        // Chart Background
        ctx.fillStyle = '#f9f9f9';
        ctx.fillRect(padding, chartY, width - padding * 2, chartHeight);

        if (records.length > 1) {
          this.drawMiniChart(ctx, records, padding, chartY, width - padding * 2, chartHeight);
        } else {
          ctx.fillStyle = '#999';
          ctx.font = '14px sans-serif';
          ctx.fillText('数据不足，无法绘制趋势', width / 2, chartY + chartHeight / 2);
        }

        // Interpretation Text
        ctx.fillStyle = '#666666';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.data.stats.interpretation, width / 2, chartY + chartHeight + 30);

        // Footer
        const footerY = height - 30;
        ctx.fillStyle = '#999999';
        ctx.font = '10px sans-serif';
        
        const timeStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        ctx.fillText(`报告生成时间：${timeStr}`, width / 2, footerY);
        ctx.fillText('由「安压宝」小程序生成', width / 2, footerY + 15);
      });
  },

  drawStatItem(ctx: any, label: string, value: string, x: number, y: number, color: string = '#333') {
    ctx.fillStyle = '#999';
    ctx.font = '12px sans-serif';
    ctx.fillText(label, x, y);
    
    ctx.fillStyle = color;
    ctx.font = 'bold 24px DIN Alternate, sans-serif';
    ctx.fillText(value, x, y + 30);
  },

  drawMiniChart(ctx: any, records: any[], x: number, y: number, w: number, h: number) {
    // Simple line chart
    const sysValues = records.map(r => r.systolic);
    const diaValues = records.map(r => r.diastolic);
    const allValues = [...sysValues, ...diaValues];
    
    // Fixed range for better visualization of zones
    let minVal = Math.min(...allValues) - 10;
    let maxVal = Math.max(...allValues) + 10;
    if (minVal > 60) minVal = 60;
    if (maxVal < 180) maxVal = 180;
    
    const range = maxVal - minVal;

    const getX = (i: number) => x + (i / (records.length - 1)) * w;
    const getY = (v: number) => y + h - ((v - minVal) / range) * h;

    // Draw Reference Zones
    // Normal: <140 (Green tint)
    // Level 1: 140-160 (Yellow tint)
    // Level 2+: >160 (Red tint)
    
    const y140 = getY(140);
    const y160 = getY(160);
    const yTop = y;
    const yBottom = y + h;

    // Zone > 160 (Red)
    if (y160 > yTop) {
        ctx.fillStyle = 'rgba(255, 77, 79, 0.1)';
        ctx.fillRect(x, yTop, w, Math.max(0, y160 - yTop));
    }
    
    // Zone 140-160 (Yellow)
    if (y140 > yTop) {
        const top = Math.max(yTop, y160);
        const bottom = Math.min(yBottom, y140);
        if (bottom > top) {
            ctx.fillStyle = 'rgba(250, 173, 20, 0.1)';
            ctx.fillRect(x, top, w, bottom - top);
        }
    }

    // Zone < 140 (Green)
    if (y140 < yBottom) {
        const top = Math.max(yTop, y140);
        ctx.fillStyle = 'rgba(82, 196, 26, 0.1)';
        ctx.fillRect(x, top, w, yBottom - top);
    }

    // Draw Reference Lines
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    
    // 140 Line
    if (y140 >= yTop && y140 <= yBottom) {
        ctx.beginPath();
        ctx.moveTo(x, y140);
        ctx.lineTo(x + w, y140);
        ctx.stroke();
        ctx.fillStyle = '#999';
        ctx.font = '10px sans-serif';
        ctx.fillText('140', x + 5, y140 - 2);
    }

    // 90 Line
    const y90 = getY(90);
    if (y90 >= yTop && y90 <= yBottom) {
        ctx.beginPath();
        ctx.moveTo(x, y90);
        ctx.lineTo(x + w, y90);
        ctx.stroke();
        ctx.fillText('90', x + 5, y90 - 2);
    }
    
    ctx.setLineDash([]);

    // Draw Systolic Line
    ctx.beginPath();
    ctx.strokeStyle = '#FF6B6B';
    ctx.lineWidth = 2;
    records.forEach((r, i) => {
      if (i === 0) ctx.moveTo(getX(i), getY(r.systolic));
      else ctx.lineTo(getX(i), getY(r.systolic));
    });
    ctx.stroke();

    // Draw Diastolic Line
    ctx.beginPath();
    ctx.strokeStyle = '#4D96FF';
    records.forEach((r, i) => {
      if (i === 0) ctx.moveTo(getX(i), getY(r.diastolic));
      else ctx.lineTo(getX(i), getY(r.diastolic));
    });
    ctx.stroke();
  },

  onSaveImage() {
    const query = wx.createSelectorQuery();
    query.select('#shareCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res[0].node;
        wx.canvasToTempFilePath({
          canvas,
          success: (res) => {
            wx.saveImageToPhotosAlbum({
              filePath: res.tempFilePath,
              success: () => {
                wx.showToast({ title: '已保存到相册', icon: 'success' });
              },
              fail: (err) => {
                console.error(err);
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
        });
      });
  },

  onShareAppMessage() {
    return {
      title: '我的血压健康报告',
      path: '/pages/share/share'
    };
  }
});

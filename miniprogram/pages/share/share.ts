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
    tableData: [] as any[],
    canvasWidth: 300,
    canvasHeight: 550,
    isGenerating: false,
    tempFilePath: '' as string
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
      
      // Process table data
      const tableData = this.processTableData(records);
      
      // Calculate required canvas height
      // Header area: ~110px (Margins 20 + Title 30 + Header 60)
      // Rows: tableData.length * 30
      // Footer area: ~40px
      const rowHeight = 30;
      const headerHeight = 110;
      const footerHeight = 40;
      const totalHeight = headerHeight + (tableData.length * rowHeight) + footerHeight;
      
      const sysInfo = wx.getSystemInfoSync();
      const canvasWidth = sysInfo.screenWidth;

      this.setData({ 
        tableData,
        canvasHeight: totalHeight,
        canvasWidth: canvasWidth
      }, () => {
        // Draw table to canvas for sharing
        setTimeout(() => {
          this.drawTableToCanvas(tableData);
        }, 500);
      });

    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // Process records into daily table format with morning/noon/evening averages
  processTableData(allRecords: any[]) {
    if (!allRecords || allRecords.length === 0) return [];

    // Group by date
    const grouped: { [key: string]: { morning: any[], noon: any[], evening: any[] } } = {};
    
    allRecords.forEach(r => {
      const d = new Date(r.measured_at);
      const dateStr = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
      const hour = d.getHours();

      if (!grouped[dateStr]) {
        grouped[dateStr] = { morning: [], noon: [], evening: [] };
      }

      // Morning: 4:00-10:59, Noon: 11:00-15:59, Evening: 16:00-3:59
      if (hour >= 4 && hour < 11) {
        grouped[dateStr].morning.push(r);
      } else if (hour >= 11 && hour < 16) {
        grouped[dateStr].noon.push(r);
      } else {
        grouped[dateStr].evening.push(r);
      }
    });

    // Calculate averages for each period
    const calcAvg = (arr: any[]) => {
      if (arr.length === 0) return { sys: null, dia: null, hr: null };
      const sys = Math.round(arr.reduce((acc, cur) => acc + cur.systolic, 0) / arr.length);
      const dia = Math.round(arr.reduce((acc, cur) => acc + cur.diastolic, 0) / arr.length);
      const hr = Math.round(arr.reduce((acc, cur) => acc + (cur.heart_rate || 0), 0) / arr.length);
      return { sys, dia, hr };
    };

    // Convert to array and sort by date (newest first)
    const result = Object.keys(grouped)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
      .map(date => {
        const dayData = grouped[date];
        const dateObj = new Date(date);
        const dateLabel = `${dateObj.getMonth() + 1}-${dateObj.getDate()}`;
        
        return {
          date,
          dateLabel,
          morning: calcAvg(dayData.morning),
          noon: calcAvg(dayData.noon),
          evening: calcAvg(dayData.evening)
        };
      });

    return result;
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

  drawTableToCanvas(data: any[]) {
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

        // White background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        // Margins
        const marginX = 10;
        const marginY = 20;
        const contentWidth = width - marginX * 2;

        // Title
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('血压记录表', width / 2, marginY + 10);

        // Table Header
        const tableTop = marginY + 30;
        const rowHeight = 30; // Fixed row height
        
        // Column widths
        // Date: 15%, Morning: 28%, Noon: 28%, Evening: 28%
        const colDateW = contentWidth * 0.16;
        const colSectionW = (contentWidth - colDateW) / 3;
        const colItemW = colSectionW / 3;

        ctx.lineWidth = 1;
        ctx.strokeStyle = '#e0e0e0';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Draw Header Row 1 (Date, Morning, Noon, Evening)
        let currentX = marginX;
        const headerY1 = tableTop;
        const headerY2 = tableTop + rowHeight;
        
        // Header Background
        ctx.fillStyle = '#1890ff';
        ctx.fillRect(marginX, headerY1, contentWidth, rowHeight);
        ctx.fillStyle = '#e6f7ff';
        ctx.fillRect(marginX, headerY2, contentWidth, rowHeight);

        ctx.fillStyle = '#ffffff'; // Text color for main header

        // Date Box
        ctx.strokeRect(currentX, headerY1, colDateW, rowHeight * 2);
        ctx.fillText('日期', currentX + colDateW/2, headerY1 + rowHeight/2);
        currentX += colDateW;

        // Sections
        ['早上', '中午', '晚上'].forEach(section => {
          ctx.strokeRect(currentX, headerY1, colSectionW, rowHeight);
          ctx.fillText(section, currentX + colSectionW/2, headerY1 + rowHeight/2);
          
          // Sub headers
          ctx.save();
          ctx.fillStyle = '#1890ff'; // Text color for sub header
          ['收缩', '舒张', '心率'].forEach((sub, idx) => {
            ctx.strokeRect(currentX + idx * colItemW, headerY2, colItemW, rowHeight);
            ctx.fillText(sub, currentX + idx * colItemW + colItemW/2, headerY2 + rowHeight/2);
          });
          ctx.restore();
          
          currentX += colSectionW;
        });

        // Draw Data Rows
        let currentY = headerY2 + rowHeight;
        ctx.fillStyle = '#333333'; // Data text color
        
        // Use all data, no row limit
        const displayData = data;

        displayData.forEach((row, index) => {
          currentX = marginX;
          
          // Zebra striping
          if (index % 2 === 1) {
            ctx.fillStyle = '#fafafa';
            ctx.fillRect(currentX, currentY, contentWidth, rowHeight);
            ctx.fillStyle = '#333333';
          }

          // Date
          ctx.strokeRect(currentX, currentY, colDateW, rowHeight);
          const dateObj = new Date(row.date);
          const dateStr = `${dateObj.getMonth()+1}-${dateObj.getDate()}`;
          ctx.fillText(dateStr, currentX + colDateW/2, currentY + rowHeight/2);
          currentX += colDateW;

          // Data
          [row.morning, row.noon, row.evening].forEach(item => {
            if (item && item.sys) {
              // Sys
              ctx.strokeRect(currentX, currentY, colItemW, rowHeight);
              if (item.sys >= 140) ctx.fillStyle = '#ff4d4f';
              ctx.fillText(item.sys.toString(), currentX + colItemW/2, currentY + rowHeight/2);
              ctx.fillStyle = '#333333';
              
              // Dia
              ctx.strokeRect(currentX + colItemW, currentY, colItemW, rowHeight);
              if (item.dia >= 90) ctx.fillStyle = '#ff4d4f';
              ctx.fillText(item.dia.toString(), currentX + colItemW * 1.5, currentY + rowHeight/2);
              ctx.fillStyle = '#333333';
              
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
        ctx.fillText('由「安压宝」生成', width - marginX, height - 5);

        // Generate temp file path
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'jpg',
          quality: 0.8,
          success: (res) => {
            this.setData({ tempFilePath: res.tempFilePath });
          }
        });
      });
  },

  onShareImage() {
    if (!this.data.tempFilePath) {
      wx.showToast({ title: '正在生成图片...', icon: 'none' });
      return;
    }

    wx.showShareImageMenu({
      path: this.data.tempFilePath,
      success: () => {
        console.log('分享成功');
      },
      fail: (err) => {
        console.log('showShareImageMenu failed, trying preview', err);
        wx.previewImage({
          urls: [this.data.tempFilePath],
          current: this.data.tempFilePath
        });
      }
    });
  },

  onShareAppMessage() {
    return {
      title: '我的血压健康报告',
      path: '/pages/index/index',
      imageUrl: this.data.tempFilePath || undefined
    };
  }
});



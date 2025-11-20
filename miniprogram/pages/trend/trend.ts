import { request } from '../../utils/request';

Page({
  data: {
    canvasWidth: 300,
    scrollLeft: 0,
    canvasWidthHR: 300,
    scrollLeftHR: 0
  },

  onShow() {
    this.loadDataAndDraw();
  },

  async loadDataAndDraw() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;

    try {
      const res = await request<{ data: any[] }>({
        url: `/records?openid=${openid}`,
        method: 'GET'
      });

      // 取最近 30 条记录，按时间升序排列（旧 -> 新）
      const records = res.data
        .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime())
        .slice(-30);

      if (records.length === 0) return;

      this.drawChart(records);
      this.drawHeartRateChart(records);

    } catch (err) {
      console.error('Failed to load trend data', err);
    }
  },

  drawChart(records: any[]) {
    const sysInfo = wx.getSystemInfoSync();
    
    // Parse all timestamps
    const timestamps = records.map(r => new Date(r.measured_at).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const timeRange = maxTime - minTime;
    
    // Calculate width based on time span (Grafana-like approach)
    // If time range is small or zero, use minimum width
    const pixelsPerDay = 100; // How many pixels per day
    const daysSpan = timeRange / (1000 * 60 * 60 * 24);
    const minWidth = sysInfo.windowWidth - 40;

    // Ensure enough space for each point (fix for short time range with many points)
    const pixelsPerPoint = 60;
    const widthByPoints = records.length * pixelsPerPoint;

    const calculatedWidth = Math.max(minWidth, daysSpan * pixelsPerDay + 100, widthByPoints);

    this.setData({ canvasWidth: calculatedWidth }, () => {
      const query = wx.createSelectorQuery();
      query.select('#trendChart')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res[0]) return;
          
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');

          const dpr = sysInfo.pixelRatio;
          const width = calculatedWidth;
          const height = res[0].height;

          canvas.width = width * dpr;
          canvas.height = height * dpr;
          ctx.scale(dpr, dpr);

          const paddingLeft = 50;
          const paddingRight = 20;
          const paddingTop = 30;
          const paddingBottom = 40;
          const graphWidth = width - paddingLeft - paddingRight;
          const graphHeight = height - paddingTop - paddingBottom;

          // Clear
          ctx.clearRect(0, 0, width, height);

          // Background (white for light theme)
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);

          // Find min/max for Y axis scaling
          const allValues = records.flatMap(r => [r.systolic, r.diastolic]);
          const minVal = Math.floor(Math.min(...allValues) / 10) * 10 - 10;
          const maxVal = Math.ceil(Math.max(...allValues) / 10) * 10 + 10;
          const range = maxVal - minVal;

          // Helper to map value to Y coordinate
          const getY = (val: number) => {
            return paddingTop + graphHeight - ((val - minVal) / range) * graphHeight;
          };

          // Helper to map timestamp to X coordinate (Grafana-style: based on actual time)
          const getX = (timestamp: number) => {
            if (timeRange === 0) return paddingLeft + graphWidth / 2;
            const ratio = (timestamp - minTime) / timeRange;
            return paddingLeft + ratio * graphWidth;
          };

          // Draw Grid Lines (Grafana light theme style)
          ctx.strokeStyle = 'rgba(36, 41, 46, 0.12)';
          ctx.lineWidth = 1;
          
          // Horizontal grid lines
          const ySteps = 5;
          for (let i = 0; i <= ySteps; i++) {
            const y = paddingTop + (i / ySteps) * graphHeight;
            ctx.beginPath();
            ctx.moveTo(paddingLeft, y);
            ctx.lineTo(width - paddingRight, y);
            ctx.stroke();
            
            // Y axis labels
            const val = maxVal - (i / ySteps) * range;
            ctx.fillStyle = '#52545c';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(val).toString(), paddingLeft - 8, y + 4);
          }

          // Draw Hypertension Threshold Lines (China Standard)
          const thresholds = [
            { value: 180, label: '3级', color: 'rgba(255, 59, 48, 0.6)' },   // Red
            { value: 160, label: '2级', color: 'rgba(255, 149, 0, 0.6)' },   // Orange
            { value: 140, label: '1级', color: 'rgba(255, 204, 0, 0.6)' },   // Yellow
            { value: 110, label: '3级(低)', color: 'rgba(255, 59, 48, 0.6)' },
            { value: 100, label: '2级(低)', color: 'rgba(255, 149, 0, 0.6)' },
            { value: 90, label: '1级(低)', color: 'rgba(255, 204, 0, 0.6)' },
          ];

          ctx.save();
          ctx.setLineDash([4, 2]);
          ctx.lineWidth = 1;
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'right';

          thresholds.forEach(t => {
            // Only draw if within current view range
            if (t.value > minVal && t.value < maxVal) {
              const y = getY(t.value);
              
              ctx.beginPath();
              ctx.strokeStyle = t.color;
              ctx.fillStyle = t.color;
              
              // Draw line
              ctx.moveTo(paddingLeft, y);
              ctx.lineTo(width - paddingRight, y);
              ctx.stroke();
              
              // Draw label
              ctx.fillText(`${t.label} ${t.value}`, width - paddingRight, y - 4);
            }
          });
          ctx.restore();

          // Vertical grid lines (time-based)
          const xSteps = Math.min(10, records.length);
          for (let i = 0; i <= xSteps; i++) {
            const timeVal = minTime + (i / xSteps) * timeRange;
            const x = getX(timeVal);
            ctx.beginPath();
            ctx.moveTo(x, paddingTop);
            ctx.lineTo(x, height - paddingBottom);
            ctx.strokeStyle = 'rgba(36, 41, 46, 0.12)';
            ctx.stroke();
          }

          // Draw area fill (Grafana-style gradient fill under lines)
          const drawAreaFill = (dataKey: string, color: string, alpha: number) => {
            const gradient = ctx.createLinearGradient(0, paddingTop, 0, height - paddingBottom);
            gradient.addColorStop(0, color.replace('rgb', 'rgba').replace(')', `, ${alpha})`));
            gradient.addColorStop(1, color.replace('rgb', 'rgba').replace(')', ', 0)'));
            
            ctx.beginPath();
            records.forEach((r, i) => {
              const x = getX(timestamps[i]);
              const y = getY(r[dataKey]);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            // Close the path to bottom
            const lastX = getX(timestamps[timestamps.length - 1]);
            ctx.lineTo(lastX, height - paddingBottom);
            ctx.lineTo(getX(timestamps[0]), height - paddingBottom);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();
          };

          // Draw Lines (Grafana-style: smooth and prominent)
          const drawLine = (dataKey: string, color: string) => {
            // Draw area first
            drawAreaFill(dataKey, color, 0.2);
            
            // Draw line
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            
            records.forEach((r, i) => {
              const x = getX(timestamps[i]);
              const y = getY(r[dataKey]);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.stroke();

            // Draw Points with hover effect style
            records.forEach((r, i) => {
              const x = getX(timestamps[i]);
              const y = getY(r[dataKey]);
              
              // Outer circle (glow)
              ctx.beginPath();
              ctx.arc(x, y, 5, 0, Math.PI * 2);
              ctx.fillStyle = color.replace('rgb', 'rgba').replace(')', ', 0.3)');
              ctx.fill();
              
              // Inner circle
              ctx.beginPath();
              ctx.arc(x, y, 3, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
              
              ctx.beginPath();
              ctx.arc(x, y, 3, 0, Math.PI * 2);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 1.5;
              ctx.stroke();
              
              // Draw value label above point
              ctx.save();
              ctx.fillStyle = color;
              ctx.font = 'bold 11px sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';
              
              // Add background rectangle for better readability
              const text = r[dataKey].toString();
              const metrics = ctx.measureText(text);
              const textWidth = metrics.width;
              const textHeight = 12;
              const padding = 3;
              
              ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
              ctx.fillRect(
                x - textWidth / 2 - padding,
                y - textHeight - padding - 8,
                textWidth + padding * 2,
                textHeight + padding * 2
              );
              
              // Draw border
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.strokeRect(
                x - textWidth / 2 - padding,
                y - textHeight - padding - 8,
                textWidth + padding * 2,
                textHeight + padding * 2
              );
              
              // Draw text
              ctx.fillStyle = color;
              ctx.fillText(text, x, y - 8);
              ctx.restore();
            });
          };

          drawLine('systolic', 'rgb(255, 152, 0)');
          drawLine('diastolic', 'rgb(54, 162, 235)');

          // Draw X Axis Labels (Time-based, Grafana style)
          ctx.fillStyle = '#52545c';
          ctx.textAlign = 'center';
          ctx.font = '11px sans-serif';
          
          // Show time labels at regular intervals
          const labelSteps = Math.min(8, records.length);
          for (let i = 0; i <= labelSteps; i++) {
            const idx = Math.floor((i / labelSteps) * (records.length - 1));
            if (idx >= records.length) continue;
            
            const date = new Date(records[idx].measured_at);
            const x = getX(timestamps[idx]);
            
            // Format time label
            const month = date.getMonth() + 1;
            const day = date.getDate();
            const hour = date.getHours().toString().padStart(2, '0');
            const minute = date.getMinutes().toString().padStart(2, '0');
            
            // Show date and time
            ctx.fillText(`${month}/${day}`, x, height - paddingBottom + 15);
            ctx.fillText(`${hour}:${minute}`, x, height - paddingBottom + 28);
          }

          // Scroll to the end (rightmost)
          this.setData({
            scrollLeft: width
          });
        });
    });
  },

  drawHeartRateChart(records: any[]) {
    const sysInfo = wx.getSystemInfoSync();
    
    // Parse all timestamps
    const timestamps = records.map(r => new Date(r.measured_at).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const timeRange = maxTime - minTime;
    
    // Calculate width based on time span
    const pixelsPerDay = 100;
    const daysSpan = timeRange / (1000 * 60 * 60 * 24);
    const minWidth = sysInfo.windowWidth - 40;

    // Ensure enough space for each point
    const pixelsPerPoint = 60;
    const widthByPoints = records.length * pixelsPerPoint;

    const calculatedWidth = Math.max(minWidth, daysSpan * pixelsPerDay + 100, widthByPoints);

    this.setData({ canvasWidthHR: calculatedWidth }, () => {
      const query = wx.createSelectorQuery();
      query.select('#heartRateChart')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res[0]) return;
          
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');

          const dpr = sysInfo.pixelRatio;
          const width = calculatedWidth;
          const height = res[0].height;

          canvas.width = width * dpr;
          canvas.height = height * dpr;
          ctx.scale(dpr, dpr);

          const paddingLeft = 50;
          const paddingRight = 20;
          const paddingTop = 30;
          const paddingBottom = 40;
          const graphWidth = width - paddingLeft - paddingRight;
          const graphHeight = height - paddingTop - paddingBottom;

          // Clear
          ctx.clearRect(0, 0, width, height);

          // Background (white for light theme)
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);

          // Filter records with heart rate data
          const hrRecords = records.filter(r => r.heart_rate);
          if (hrRecords.length === 0) {
            ctx.fillStyle = '#999';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('暂无心率数据', width / 2, height / 2);
            return;
          }

          const hrTimestamps = hrRecords.map(r => new Date(r.measured_at).getTime());
          const hrValues = hrRecords.map(r => r.heart_rate);
          const minVal = Math.floor(Math.min(...hrValues) / 10) * 10 - 10;
          const maxVal = Math.ceil(Math.max(...hrValues) / 10) * 10 + 10;
          const range = maxVal - minVal;

          // Helper to map value to Y coordinate
          const getY = (val: number) => {
            return paddingTop + graphHeight - ((val - minVal) / range) * graphHeight;
          };

          // Helper to map timestamp to X coordinate
          const getX = (timestamp: number) => {
            if (timeRange === 0) return paddingLeft + graphWidth / 2;
            const ratio = (timestamp - minTime) / timeRange;
            return paddingLeft + ratio * graphWidth;
          };

          // Draw Grid Lines
          ctx.strokeStyle = 'rgba(36, 41, 46, 0.12)';
          ctx.lineWidth = 1;
          
          const ySteps = 5;
          for (let i = 0; i <= ySteps; i++) {
            const y = paddingTop + (i / ySteps) * graphHeight;
            ctx.beginPath();
            ctx.moveTo(paddingLeft, y);
            ctx.lineTo(width - paddingRight, y);
            ctx.stroke();
            
            const val = maxVal - (i / ySteps) * range;
            ctx.fillStyle = '#52545c';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(val).toString(), paddingLeft - 8, y + 4);
          }

          const xSteps = Math.min(10, hrRecords.length);
          for (let i = 0; i <= xSteps; i++) {
            const timeVal = minTime + (i / xSteps) * timeRange;
            const x = getX(timeVal);
            ctx.beginPath();
            ctx.moveTo(x, paddingTop);
            ctx.lineTo(x, height - paddingBottom);
            ctx.strokeStyle = 'rgba(36, 41, 46, 0.12)';
            ctx.stroke();
          }

          const color = 'rgb(255, 59, 48)';

          // Draw area fill
          const gradient = ctx.createLinearGradient(0, paddingTop, 0, height - paddingBottom);
          gradient.addColorStop(0, 'rgba(255, 59, 48, 0.2)');
          gradient.addColorStop(1, 'rgba(255, 59, 48, 0)');
          
          ctx.beginPath();
          hrRecords.forEach((r, i) => {
            const x = getX(hrTimestamps[i]);
            const y = getY(r.heart_rate);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          const lastX = getX(hrTimestamps[hrTimestamps.length - 1]);
          ctx.lineTo(lastX, height - paddingBottom);
          ctx.lineTo(getX(hrTimestamps[0]), height - paddingBottom);
          ctx.closePath();
          ctx.fillStyle = gradient;
          ctx.fill();

          // Draw line
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          
          hrRecords.forEach((r, i) => {
            const x = getX(hrTimestamps[i]);
            const y = getY(r.heart_rate);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();

          // Draw points with values
          hrRecords.forEach((r, i) => {
            const x = getX(hrTimestamps[i]);
            const y = getY(r.heart_rate);
            
            // Outer circle (glow)
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 59, 48, 0.3)';
            ctx.fill();
            
            // Inner circle
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            // Draw value label
            ctx.save();
            ctx.fillStyle = color;
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            
            const text = r.heart_rate.toString();
            const metrics = ctx.measureText(text);
            const textWidth = metrics.width;
            const textHeight = 12;
            const padding = 3;
            
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(
              x - textWidth / 2 - padding,
              y - textHeight - padding - 8,
              textWidth + padding * 2,
              textHeight + padding * 2
            );
            
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.strokeRect(
              x - textWidth / 2 - padding,
              y - textHeight - padding - 8,
              textWidth + padding * 2,
              textHeight + padding * 2
            );
            
            ctx.fillStyle = color;
            ctx.fillText(text, x, y - 8);
            ctx.restore();
          });

          // Draw X Axis Labels
          ctx.fillStyle = '#52545c';
          ctx.textAlign = 'center';
          ctx.font = '11px sans-serif';
          
          const labelSteps = Math.min(8, hrRecords.length);
          for (let i = 0; i <= labelSteps; i++) {
            const idx = Math.floor((i / labelSteps) * (hrRecords.length - 1));
            if (idx >= hrRecords.length) continue;
            
            const date = new Date(hrRecords[idx].measured_at);
            const x = getX(hrTimestamps[idx]);
            
            const month = date.getMonth() + 1;
            const day = date.getDate();
            const hour = date.getHours().toString().padStart(2, '0');
            const minute = date.getMinutes().toString().padStart(2, '0');
            
            ctx.fillText(`${month}/${day}`, x, height - paddingBottom + 15);
            ctx.fillText(`${hour}:${minute}`, x, height - paddingBottom + 28);
          }

          this.setData({
            scrollLeftHR: width
          });
        });
    });
  }
});

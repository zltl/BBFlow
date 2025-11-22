import { request } from '../../utils/request';

Page({
  data: {
    canvasWidth: 300,
    scrollLeft: 0,
    canvasWidthHR: 300,
    scrollLeftHR: 0,
    tooltip: {
      visible: false,
      x: 0,
      y: 0,
      date: '',
      time: '',
      systolic: 0,
      diastolic: 0,
      heartRate: 0
    }
  },

  isSyncingScroll: false,
  
  // Pagination state
  _allRecords: [] as any[],
  _chartPoints: [] as any[],
  _renderedCount: 0,
  _isLoadingMore: false,
  PAGE_SIZE: 30,

  onShow() {
    this.loadDataAndDraw();
  },

  calculateWidth(records: any[]) {
    const days = Array.from(new Set(records.map(r => {
        const d = new Date(r.measured_at);
        return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    })));
    const pixelsPerDay = 200;
    return days.length * pixelsPerDay + 60;
  },

  async loadDataAndDraw() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;

    try {
      const res = await request<{ data: any[] }>({
        url: `/records?openid=${openid}`,
        method: 'GET'
      });

      // Sort by time (old -> new)
      const records = res.data
        .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime());

      if (records.length === 0) return;

      this._allRecords = records;
      this._renderedCount = Math.min(this.PAGE_SIZE, records.length);
      
      const displayRecords = this._allRecords.slice(-this._renderedCount);
      const width = this.calculateWidth(displayRecords);

      // Initial render: set width and scroll to end
      this.setData({ 
        canvasWidth: width,
        canvasWidthHR: width, // Assuming same width for HR
        scrollLeft: width,
        scrollLeftHR: width
      }, () => {
        this.drawChart(displayRecords);
        this.drawHeartRateChart(displayRecords);
      });

    } catch (err) {
      console.error('Failed to load trend data', err);
    }
  },

  onScrollToLeft() {
    if (this._isLoadingMore || this._renderedCount >= this._allRecords.length) return;
    
    this._isLoadingMore = true;
    const oldWidth = this.data.canvasWidth;
    
    // Load more records
    this._renderedCount = Math.min(this._renderedCount + this.PAGE_SIZE, this._allRecords.length);
    const displayRecords = this._allRecords.slice(-this._renderedCount);
    
    const newWidth = this.calculateWidth(displayRecords);
    const scrollDiff = newWidth - oldWidth;

    // Update width and adjust scroll position to maintain visual stability
    this.setData({
      canvasWidth: newWidth,
      canvasWidthHR: newWidth,
      scrollLeft: this.data.scrollLeft + scrollDiff,
      scrollLeftHR: this.data.scrollLeftHR + scrollDiff
    }, () => {
      this.drawChart(displayRecords);
      this.drawHeartRateChart(displayRecords);
      
      // Small delay to prevent double triggering
      setTimeout(() => {
        this._isLoadingMore = false;
      }, 500);
    });
  },

  // Helper function to draw smooth curves using Catmull-Rom splines
  drawSmoothLine(ctx: any, points: {x: number, y: number}[], tension: number = 0.5) {
    if (points.length < 2) return;
    
    ctx.moveTo(points[0].x, points[0].y);
    
    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
      return;
    }
    
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? i : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
      
      const cp1x = p1.x + (p2.x - p0.x) / 6 * tension;
      const cp1y = p1.y + (p2.y - p0.y) / 6 * tension;
      const cp2x = p2.x - (p3.x - p1.x) / 6 * tension;
      const cp2y = p2.y - (p3.y - p1.y) / 6 * tension;
      
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  },

  // Scroll synchronization state
  _scrollSource: null as 'BP' | 'HR' | null,
  _scrollTimeout: null as number | null,

  handleBPScroll(e: WechatMiniprogram.ScrollViewScroll) {
    // If currently synced by HR, ignore this event
    if (this._scrollSource === 'HR') return;

    this._scrollSource = 'BP';
    
    // Only update the OTHER chart
    this.setData({
      scrollLeftHR: e.detail.scrollLeft
    });

    this._resetScrollSource();
  },

  handleHRScroll(e: WechatMiniprogram.ScrollViewScroll) {
    // If currently synced by BP, ignore this event
    if (this._scrollSource === 'BP') return;

    this._scrollSource = 'HR';

    // Only update the OTHER chart
    this.setData({
      scrollLeft: e.detail.scrollLeft
    });

    this._resetScrollSource();
  },

  _resetScrollSource() {
    if (this._scrollTimeout) clearTimeout(this._scrollTimeout);
    this._scrollTimeout = setTimeout(() => {
      this._scrollSource = null;
    }, 100) as unknown as number;
  },

  onChartLongPress(e: WechatMiniprogram.TouchEvent) {
    if (!this._chartPoints || this._chartPoints.length === 0) return;
    
    const touch = e.touches[0] as any;
    if (!touch) return;
    
    const { x } = touch;
    
    // Find nearest point
    let minDist = Infinity;
    let nearestPoint = null;
    
    for (const point of this._chartPoints) {
      const dist = Math.abs(point.x - x);
      if (dist < minDist) {
        minDist = dist;
        nearestPoint = point;
      }
    }
    
    // Threshold for selection (e.g., 30px)
    if (minDist > 30 || !nearestPoint) {
      this.setData({ 'tooltip.visible': false });
      return;
    }
    
    const r = nearestPoint.record;
    const d = new Date(r.measured_at);
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
    const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    
    // Calculate tooltip position relative to the container
    // The chart is inside a scroll-view which starts at left: 0 (overlapping with absolute Y-axis)
    // point.x is relative to the canvas content (which includes paddingLeft for Y-axis)
    // We need to subtract scrollLeft to get position relative to the scroll viewport
    const tooltipX = nearestPoint.x - this.data.scrollLeft;
    const tooltipY = nearestPoint.y; // Relative to canvas top, which aligns with container top
    
    this.setData({
      tooltip: {
        visible: true,
        x: tooltipX,
        y: tooltipY,
        date: dateStr,
        time: timeStr,
        systolic: r.systolic,
        diastolic: r.diastolic,
        heartRate: r.heart_rate || '--'
      }
    });
  },

  onChartTouchEnd() {
    this.setData({ 'tooltip.visible': false });
  },

  drawChart(records: any[]) {
    const sysInfo = wx.getSystemInfoSync();
    
    // Use shared time range for synchronization
    const timestamps = records.map(r => new Date(r.measured_at).getTime());
    
    // 1. Group by day to determine layout
    const days = Array.from(new Set(records.map(r => {
        const d = new Date(r.measured_at);
        return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    }))).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const pixelsPerDay = 200; // Fixed width per day
    const calculatedWidth = days.length * pixelsPerDay + 60; // Add buffer

    const query = wx.createSelectorQuery();
    query.select('#trendChart').fields({ node: true, size: true });
    query.select('#yAxisBP').fields({ node: true, size: true });
    
    query.exec((res) => {
        if (!res[0] || !res[1]) return;
        
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const yAxisCanvas = res[1].node;
        const yCtx = yAxisCanvas.getContext('2d');

        const dpr = sysInfo.pixelRatio;
        const width = calculatedWidth;
        const height = res[0].height;
        const yAxisWidth = res[1].width;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        yAxisCanvas.width = yAxisWidth * dpr;
        yAxisCanvas.height = height * dpr;
        yCtx.scale(dpr, dpr);

          const paddingLeft = yAxisWidth + 10; // Ensure start of chart clears the Y-axis overlay
          const paddingRight = 20;
          const paddingTop = 30;
          const paddingBottom = 50; // Increased for dual labels
          // const graphWidth = width - paddingLeft - paddingRight;
          const graphHeight = height - paddingTop - paddingBottom;

          // Clear both canvases
          ctx.clearRect(0, 0, width, height);
          yCtx.clearRect(0, 0, yAxisWidth, height);

          // Background (white for light theme)
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          
          // Y-axis background (semi-transparent)
          yCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          yCtx.fillRect(0, 0, yAxisWidth, height);

          // Find min/max for Y axis scaling
          const allValues = records.flatMap(r => [r.systolic, r.diastolic]);
          let minVal = Math.floor(Math.min(...allValues) / 20) * 20 - 20;
          let maxVal = Math.ceil(Math.max(...allValues) / 20) * 20 + 20;
          
          // Enforce minimum range and boundaries
          if (minVal > 40) minVal = 40;
          if (maxVal < 180) maxVal = 180;
          
          // Ensure interval is 20
          const range = maxVal - minVal;
          const stepSize = 20;
          const ySteps = Math.round(range / stepSize);

          // Helper to map value to Y coordinate
          const getY = (val: number) => {
            return paddingTop + graphHeight - ((val - minVal) / range) * graphHeight;
          };

          // Helper to map timestamp to X coordinate (Day-based layout)
          const getX = (timestamp: number) => {
            const d = new Date(timestamp);
            const dateStr = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
            const dayIndex = days.indexOf(dateStr);
            if (dayIndex === -1) return paddingLeft;

            const dayStartX = paddingLeft + dayIndex * pixelsPerDay;
            
            // Time offset within the day (0 to 1)
            const msInDay = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * 1000 + d.getMilliseconds();
            const msPerDay = 24 * 3600 * 1000;
            const ratio = msInDay / msPerDay;
            
            return dayStartX + ratio * pixelsPerDay;
          };

          // Store points for tooltip
          this._chartPoints = records.map(r => {
            const timestamp = new Date(r.measured_at).getTime();
            return {
              x: getX(timestamp),
              y: getY(r.systolic), // Use systolic Y for tooltip vertical position or just for reference
              record: r
            };
          });

          // Draw Hypertension Level Background Bands (Chinese standard)
          const hypertensionBands = [
            { min: 0, max: 140, color: 'rgba(82, 196, 26, 0.1)', label: '正常' },        // Normal (Very pale mint green)
            { min: 140, max: 160, color: 'rgba(250, 173, 20, 0.1)', label: '一级高血压' }, // Level 1 (Very pale cream yellow)
            { min: 160, max: 300, color: 'rgba(255, 77, 79, 0.1)', label: '危险区' }      // Danger Zone (Very pale pink)
          ];
          
          hypertensionBands.forEach(band => {
            if (band.max > minVal && band.min < maxVal) {
              const yTop = getY(Math.min(band.max, maxVal));
              const yBottom = getY(Math.max(band.min, minVal));
              ctx.fillStyle = band.color;
              ctx.fillRect(paddingLeft, yTop, width - paddingLeft - paddingRight, yBottom - yTop);
            }
          });

          // Draw Grid Lines (Grafana light theme style)
          ctx.strokeStyle = 'rgba(36, 41, 46, 0.12)';
          ctx.lineWidth = 1;
          
          // Horizontal grid lines
          ctx.setLineDash([4, 4]); // Dashed
          for (let i = 0; i <= ySteps; i++) {
            const y = paddingTop + (i / ySteps) * graphHeight;
            
            // Draw grid line on main chart
            ctx.beginPath();
            ctx.moveTo(paddingLeft, y);
            ctx.lineTo(width - paddingRight, y);
            ctx.stroke();
            
            // Draw label on Y-axis canvas
            const val = maxVal - i * stepSize;
            yCtx.fillStyle = '#666666';
            yCtx.font = '11px sans-serif';
            yCtx.textAlign = 'right';
            yCtx.textBaseline = 'middle';
            yCtx.fillText(Math.round(val).toString(), yAxisWidth - 5, y);
          }
          ctx.setLineDash([]); // Reset

          // Threshold lines removed for cleaner visualization
          // Users can rely on background color bands and point colors to identify abnormal values

          // Draw Day Grid and Labels
          ctx.textAlign = 'center';
          ctx.font = '11px sans-serif';
          
          days.forEach((dayStr, index) => {
             const dayStartX = paddingLeft + index * pixelsPerDay;
             const dayCenterX = dayStartX + pixelsPerDay / 2;
             
             // 1. Day Separator Line (Left border of the day)
             ctx.beginPath();
             ctx.moveTo(dayStartX, paddingTop);
             ctx.lineTo(dayStartX, height - paddingBottom);
             ctx.strokeStyle = 'rgba(36, 41, 46, 0.2)'; // Slightly darker for day boundary
             ctx.lineWidth = 1;
             ctx.stroke();

             // 2. Noon Separator (Dashed)
             const noonX = dayStartX + pixelsPerDay * 0.5;
             ctx.beginPath();
             ctx.setLineDash([4, 4]);
             ctx.moveTo(noonX, paddingTop);
             ctx.lineTo(noonX, height - paddingBottom);
             ctx.strokeStyle = 'rgba(36, 41, 46, 0.1)';
             ctx.stroke();
             ctx.setLineDash([]); // Reset

             // 3. Morning/Evening Labels (Top layer)
             ctx.fillStyle = '#666666';
             ctx.font = '11px sans-serif';
             ctx.fillText('早', dayStartX + pixelsPerDay * 0.25, height - paddingBottom + 15);
             ctx.fillText('晚', dayStartX + pixelsPerDay * 0.75, height - paddingBottom + 15);

             // 4. Date Label (Bottom layer)
             const [, month, day] = dayStr.split('-');
             const dateLabel = `${month}/${day}`;
             ctx.fillStyle = '#999999';
             ctx.font = '11px sans-serif';
             ctx.fillText(dateLabel, dayCenterX, height - paddingBottom + 35);
          });
          
          // Draw final right border
          const finalX = paddingLeft + days.length * pixelsPerDay;
          ctx.beginPath();
          ctx.moveTo(finalX, paddingTop);
          ctx.lineTo(finalX, height - paddingBottom);
          ctx.strokeStyle = 'rgba(36, 41, 46, 0.2)';
          ctx.stroke();

          // Area fill removed for cleaner visualization

          // Draw Lines (Grafana-style: smooth and prominent)
          const drawLine = (dataKey: string, color: string, normalMin: number, normalMax: number, labelPos: 'top' | 'bottom') => {
            // Skip area fill for cleaner look
            
            // Prepare points for smooth curve
            const points = records.map((r, i) => ({
              x: getX(timestamps[i]),
              y: getY(r[dataKey])
            }));
            
            // Draw smooth line
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5; // Thicker line
            ctx.lineJoin = 'round';
            this.drawSmoothLine(ctx, points, 1);
            ctx.stroke();

            // Find min and max values
            // const values = records.map(r => r[dataKey]);
            // const maxValue = Math.max(...values);
            // const minValue = Math.min(...values);

            // Draw Points
            records.forEach((r, i) => {
              const x = getX(timestamps[i]);
              const y = getY(r[dataKey]);
              const value = r[dataKey];
              const isAbnormal = value > normalMax || value < normalMin;
              
              // Determine point color
              const pointColor = isAbnormal ? '#ff4d4f' : color;
              
            // Draw point
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2); // Larger point
            ctx.fillStyle = pointColor; // Solid color
            ctx.fill();
            // ctx.lineWidth = 2;
            // ctx.strokeStyle = pointColor; // Colored border
            // ctx.stroke();
              
              // Show labels for all values
              ctx.save();
              ctx.fillStyle = isAbnormal ? '#FF4D4F' : '#333333';
              ctx.font = isAbnormal ? 'bold 12px sans-serif' : '12px sans-serif'; // Larger font
              ctx.textAlign = 'center';
              
              // Force label position based on line type to avoid overlap
              // Systolic (top) labels go up, Diastolic (bottom) labels go down
              const isTop = labelPos === 'top';
              ctx.textBaseline = isTop ? 'bottom' : 'top';
              const offsetY = isTop ? -10 : 10;
              
              const text = value.toString();
              
              // Text without background
              ctx.fillText(text, x, y + offsetY);
              ctx.restore();
            });
          };

          drawLine('systolic', '#FF6B6B', 90, 140, 'top');
          drawLine('diastolic', '#4D96FF', 60, 90, 'bottom');

          // Scroll logic moved to parent
        });
  },

  drawHeartRateChart(records: any[]) {
    const sysInfo = wx.getSystemInfoSync();
    
    // 1. Group by day to determine layout
    const days = Array.from(new Set(records.map(r => {
        const d = new Date(r.measured_at);
        return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    }))).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const pixelsPerDay = 200; // Fixed width per day
    const calculatedWidth = days.length * pixelsPerDay + 60; // Add buffer

    const query = wx.createSelectorQuery();
    query.select('#heartRateChart').fields({ node: true, size: true });
    query.select('#yAxisHR').fields({ node: true, size: true });
    
    query.exec((res) => {
        if (!res[0] || !res[1]) return;
        
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const yAxisCanvas = res[1].node;
        const yCtx = yAxisCanvas.getContext('2d');

        const dpr = sysInfo.pixelRatio;
          const width = calculatedWidth;
          const height = res[0].height;
          const yAxisWidth = res[1].width;

          canvas.width = width * dpr;
          canvas.height = height * dpr;
          ctx.scale(dpr, dpr);

          yAxisCanvas.width = yAxisWidth * dpr;
          yAxisCanvas.height = height * dpr;
          yCtx.scale(dpr, dpr);

          const paddingLeft = yAxisWidth + 10;
          const paddingRight = 20;
          const paddingTop = 30;
          const paddingBottom = 50;
          // const graphWidth = width - paddingLeft - paddingRight;
          const graphHeight = height - paddingTop - paddingBottom;

          // Clear both canvases
          ctx.clearRect(0, 0, width, height);
          yCtx.clearRect(0, 0, yAxisWidth, height);

          // Backgrounds
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          yCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
          yCtx.fillRect(0, 0, yAxisWidth, height);

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
          
          // Y-Axis Logic (Fixed interval 20)
          const stepSize = 20;
          let minVal = Math.floor(Math.min(...hrValues) / stepSize) * stepSize;
          let maxVal = Math.ceil(Math.max(...hrValues) / stepSize) * stepSize;
          
          // Enforce min/max range for consistency
          if (minVal > 40) minVal = 40;
          if (maxVal < 180) maxVal = 180;
          
          const range = maxVal - minVal;
          const ySteps = range / stepSize;

          const getY = (val: number) => {
            return paddingTop + graphHeight - ((val - minVal) / range) * graphHeight;
          };

          const getX = (timestamp: number) => {
            const d = new Date(timestamp);
            const dateStr = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
            const dayIndex = days.indexOf(dateStr);
            if (dayIndex === -1) return paddingLeft;

            const dayStartX = paddingLeft + dayIndex * pixelsPerDay;
            const msInDay = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * 1000 + d.getMilliseconds();
            const msPerDay = 24 * 3600 * 1000;
            const ratio = msInDay / msPerDay;
            return dayStartX + ratio * pixelsPerDay;
          };

          // Draw Grid Lines (Dashed)
          ctx.strokeStyle = '#E0E0E0';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          
          for (let i = 0; i <= ySteps; i++) {
            const y = paddingTop + graphHeight - (i * stepSize / range) * graphHeight;
            
            ctx.beginPath();
            ctx.moveTo(paddingLeft, y);
            ctx.lineTo(width - paddingRight, y);
            ctx.stroke();
            
            // Y-Axis Label
            const val = minVal + i * stepSize;
            yCtx.fillStyle = '#999999';
            yCtx.font = '11px sans-serif';
            yCtx.textAlign = 'right';
            yCtx.textBaseline = 'middle';
            yCtx.fillText(val.toString(), yAxisWidth - 8, y);
          }
          ctx.setLineDash([]);

          // Draw Day Grid and Labels
          ctx.textAlign = 'center';
          
          days.forEach((dayStr, index) => {
             const dayStartX = paddingLeft + index * pixelsPerDay;
             const dayCenterX = dayStartX + pixelsPerDay / 2;
             
             // Day Separator
             ctx.beginPath();
             ctx.moveTo(dayStartX, paddingTop);
             ctx.lineTo(dayStartX, height - paddingBottom);
             ctx.strokeStyle = '#E0E0E0';
             ctx.lineWidth = 1;
             ctx.stroke();

             // Noon Separator (Dashed)
             const noonX = dayStartX + pixelsPerDay * 0.5;
             ctx.beginPath();
             ctx.setLineDash([4, 4]);
             ctx.moveTo(noonX, paddingTop);
             ctx.lineTo(noonX, height - paddingBottom);
             ctx.strokeStyle = '#F0F0F0';
             ctx.stroke();
             ctx.setLineDash([]);

             // Date Label (Bottom)
             const [, month, day] = dayStr.split('-');
             const dateLabel = `${month}/${day}`;
             ctx.fillStyle = '#999999';
             ctx.font = '11px sans-serif';
             ctx.fillText(dateLabel, dayCenterX, height - 15);

             // Morning/Evening Labels (Top of X-axis area)
             ctx.fillStyle = '#666666';
             ctx.font = '11px sans-serif';
             ctx.fillText('早', dayStartX + pixelsPerDay * 0.25, height - 32);
             ctx.fillText('晚', dayStartX + pixelsPerDay * 0.75, height - 32);
          });
          
          // Right Border
          const finalX = paddingLeft + days.length * pixelsPerDay;
          ctx.beginPath();
          ctx.moveTo(finalX, paddingTop);
          ctx.lineTo(finalX, height - paddingBottom);
          ctx.strokeStyle = '#E0E0E0';
          ctx.stroke();

          // Draw Data
          const color = '#FFC107'; // Amber for Heart Rate

          const hrPoints = hrRecords.map((r, i) => ({
            x: getX(hrTimestamps[i]),
            y: getY(r.heart_rate)
          }));

          // Smooth Line
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.lineJoin = 'round';
          this.drawSmoothLine(ctx, hrPoints, 1);
          ctx.stroke();

          // Points
          hrRecords.forEach((r, i) => {
            const x = getX(hrTimestamps[i]);
            const y = getY(r.heart_rate);
            const value = r.heart_rate;
            const isAbnormal = value > 100 || value < 60;
            
            const pointColor = isAbnormal ? '#ff4d4f' : color;
            
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = pointColor;
            ctx.fill();
            // ctx.lineWidth = 2;
            // ctx.strokeStyle = pointColor;
            // ctx.stroke();
            
            // Label
            ctx.save();
            ctx.fillStyle = isAbnormal ? '#FF4D4F' : '#333333';
            ctx.font = isAbnormal ? 'bold 12px sans-serif' : '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(value.toString(), x, y - 10);
            ctx.restore();
          });

          // Scroll logic moved to parent
        });
  }
});

import { request } from '../../utils/request';

Page({
  data: {
    canvasWidth: 300,
    scrollLeft: 0,
    canvasWidthHR: 300,
    scrollLeftHR: 0,
    autoAverage: true,
    tooltip: {
      visible: false,
      x: 0,
      y: 0,
      date: '',
      time: '',
      systolic: 0,
      diastolic: 0,
      heartRate: 0
    },
    // History section data
    historyRecords: [] as any[],
    filterDate: '',
    isLoadingHistory: false,
    hasMoreHistory: true,
    viewMode: 'list' as 'list' | 'table',  // 'list' or 'table'
    currentDate: '',
    totalRecordCount: 0,
    tableData: [] as any[]  // Daily grouped table data
  },

  isSyncingScroll: false,
  
  // Pagination state for charts
  _allRecords: [] as any[],
  _chartPoints: [] as any[],
  _renderedCount: 0,
  _isLoadingMore: false,
  PAGE_SIZE: 30,

  // Pagination state for history
  _historyAllRecords: [] as any[],
  _historyPageSize: 20,
  _historyCurrentPage: 1,

  onShow() {
    const storageValue = wx.getStorageSync('autoAverage');
    const autoAverage = storageValue === '' ? true : storageValue;
    this.setData({ autoAverage });
    this.loadDataAndDraw();
    this.loadHistoryRecords();
  },

  toggleAutoAverage() {
    const newValue = !this.data.autoAverage;
    this.setData({ autoAverage: newValue });
    wx.setStorageSync('autoAverage', newValue);
    this.loadDataAndDraw();
    this.loadHistoryRecords();
  },

  mergeRecordsByTimeWindow(records: any[], windowHours: number = 2): any[] {
    if (!this.data.autoAverage || records.length === 0) return records;

    const windowMs = windowHours * 60 * 60 * 1000;
    const merged: any[] = [];
    let currentGroup: any[] = [];

    records.forEach((record, index) => {
      if (currentGroup.length === 0) {
        currentGroup.push(record);
      } else {
        const lastTime = new Date(currentGroup[0].measured_at).getTime();
        const currentTime = new Date(record.measured_at).getTime();
        
        if (Math.abs(currentTime - lastTime) <= windowMs) {
          currentGroup.push(record);
        } else {
          merged.push(this.averageGroup(currentGroup));
          currentGroup = [record];
        }
      }

      if (index === records.length - 1 && currentGroup.length > 0) {
        merged.push(this.averageGroup(currentGroup));
      }
    });

    return merged;
  },

  averageGroup(group: any[]): any {
    if (group.length === 1) return group[0];

    const avgSystolic = Math.round(group.reduce((sum, r) => sum + r.systolic, 0) / group.length);
    const avgDiastolic = Math.round(group.reduce((sum, r) => sum + r.diastolic, 0) / group.length);
    const avgHeartRate = Math.round(group.reduce((sum, r) => sum + (r.heart_rate || 0), 0) / group.length);

    return {
      ...group[0],
      systolic: avgSystolic,
      diastolic: avgDiastolic,
      heart_rate: avgHeartRate,
      _mergedCount: group.length
    };
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
      let records = res.data
        .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime());

      if (records.length === 0) return;

      // Apply auto-average if enabled
      records = this.mergeRecordsByTimeWindow(records, 2);

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

             // 3. Morning/Evening Labels (Top layer) - Removed as requested
             // ctx.fillStyle = '#666666';
             // ctx.font = '11px sans-serif';
             // ctx.fillText('早', dayStartX + pixelsPerDay * 0.25, height - paddingBottom + 15);
             // ctx.fillText('晚', dayStartX + pixelsPerDay * 0.75, height - paddingBottom + 15);

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

             // Morning/Evening Labels (Top of X-axis area) - Removed as requested
             // ctx.fillStyle = '#666666';
             // ctx.font = '11px sans-serif';
             // ctx.fillText('早', dayStartX + pixelsPerDay * 0.25, height - 32);
             // ctx.fillText('晚', dayStartX + pixelsPerDay * 0.75, height - 32);
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
  },

  // ========== History Section Methods ==========

  async loadHistoryRecords() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;

    this.setData({ isLoadingHistory: true });

    try {
      const res = await request<{ data: any[] }>({
        url: `/records?openid=${openid}`,
        method: 'GET'
      });

      let records = res.data.map(item => {
        const dateObj = new Date(item.measured_at);
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const day = dateObj.getDate().toString().padStart(2, '0');
        const hour = dateObj.getHours().toString().padStart(2, '0');
        const minute = dateObj.getMinutes().toString().padStart(2, '0');
        const level = this.getHypertensionLevel(item.systolic, item.diastolic);

        const dateKey = `${dateObj.getFullYear()}-${month}-${day}`;
        const dateLabel = `${parseInt(month, 10)}月${parseInt(day, 10)}日`;

        let tags = [];
        try {
          tags = typeof item.tags === 'string' ? JSON.parse(item.tags) : item.tags;
        } catch (e) {
          tags = item.tags ? [item.tags] : [];
        }

        return {
          ...item,
          measuredAt: this.formatDateString(item.measured_at),
          dateKey,
          dateLabel,
          timeStr: `${hour}:${minute}`,
          tags: tags,
          heartRate: item.heart_rate,
          hypertensionLevel: level
        };
      });

      if (this.data.filterDate) {
        records = records.filter(r => r.measuredAt.startsWith(this.data.filterDate));
      }

      // Apply auto-average if enabled
      records = this.mergeRecordsByTimeWindow(records, 2);

      this._historyAllRecords = records;
      this._historyCurrentPage = 1;
      this.renderHistoryPage(1);

    } catch (err) {
      console.error('Failed to load history records', err);
    } finally {
      this.setData({ isLoadingHistory: false });
    }
  },

  onReachBottom() {
    if (this.data.hasMoreHistory && !this.data.isLoadingHistory) {
      this.loadMoreHistory();
    }
  },

  loadMoreHistory() {
    this.setData({ isLoadingHistory: true });
    
    setTimeout(() => {
      this._historyCurrentPage++;
      this.renderHistoryPage(this._historyCurrentPage);
      this.setData({ isLoadingHistory: false });
    }, 300);
  },

  renderHistoryPage(page: number) {
    const pageSize = this._historyPageSize;
    const totalRecords = this._historyAllRecords.length;
    const endIndex = page * pageSize;
    
    const currentSlice = this._historyAllRecords.slice(0, endIndex);
    const groupedRecords = this.groupRecordsByDate(currentSlice);
    
    this.setData({
      historyRecords: groupedRecords,
      hasMoreHistory: endIndex < totalRecords
    });
  },

  formatDateString(isoString: string) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  },

  getHypertensionLevel(systolic: number, diastolic: number) {
    let level = -1;
    let text = '正常';
    let color = '#52c41a';
    let detail = '';

    if (systolic >= 180 || diastolic >= 110) {
      level = 3; text = '三级高血压'; color = '#ff4d4f';
    } else if (systolic >= 160 || diastolic >= 100) {
      level = 2; text = '二级高血压'; color = '#ff7a45';
    } else if (systolic >= 140 || diastolic >= 90) {
      level = 1; text = '一级高血压'; color = '#ffa940';
    } else if (systolic >= 120 || diastolic >= 80) {
      level = 0; text = '正常高值'; color = '#faad14';
    }

    if (level >= 1) {
      const sysHigh = systolic >= 140;
      const diaHigh = diastolic >= 90;
      if (sysHigh && diaHigh) {
        detail = '收缩压与舒张压均偏高';
      } else if (sysHigh) {
        detail = '收缩压偏高，舒张压正常';
      } else if (diaHigh) {
        detail = '舒张压偏高，收缩压正常';
      }
    }

    return { level, text, color, detail };
  },

  groupRecordsByDate(records: any[]) {
    const groups: any = {};
    records.forEach(record => {
      const dateKey = record.dateKey;
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(record);
    });
    return Object.keys(groups)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
      .map(key => ({
        dateKey: key,
        dateLabel: groups[key]?.[0]?.dateLabel || key,
        records: groups[key]
      }));
  },

  onDateFilterChange(e: WechatMiniprogram.PickerChange) {
    this.setData({
      filterDate: e.detail.value as string
    }, () => {
      this.loadHistoryRecords();
    });
  },

  showDetail(e: WechatMiniprogram.TouchEvent) {
    const item = e.currentTarget.dataset.item;
    wx.showModal({
      title: '记录详情',
      content: `时间: ${item.measuredAt}\n高压: ${item.systolic}\n低压: ${item.diastolic}\n心率: ${item.heartRate}\n标签: ${item.tags ? item.tags.join(', ') : '无'}\n备注: ${item.note || '无'}`,
      showCancel: false
    });
  },

  // View mode toggle methods
  switchToListView() {
    this.setData({ viewMode: 'list' });
  },

  switchToTableView() {
    // Calculate total record count
    let totalRecordCount = 0;
    this.data.historyRecords.forEach((group: any) => {
      totalRecordCount += group.records.length;
    });
    
    // Process data into daily grouped format
    const tableData = this.processTableData();
    
    this.setData({ 
      viewMode: 'table',
      totalRecordCount,
      tableData
    });
  },

  // Process records into daily table format with morning/noon/evening averages
  processTableData() {
    const allRecords = this._historyAllRecords;
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
  }
});

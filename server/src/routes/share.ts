import express, { Request, Response } from 'express';
import { pool } from '../db';
import crypto from 'crypto';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { shareGenLimiter, shareViewLimiter } from '../middleware/rateLimit';

const router = express.Router();

// 生成分享 Token
router.post('/generate-token', authenticateToken, shareGenLimiter, async (req: AuthRequest, res: Response) => {
  const openid = req.user?.openid;
  const { timeRange, shareFutureData } = req.body;

  if (!openid || !timeRange) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Generate a random token
  const token = crypto.randomBytes(16).toString('hex');
  
  // Set expiration (e.g., 7 days)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  try {
    const query = `
      INSERT INTO share_tokens (token, user_id, time_range, share_future_data, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING token, expires_at
    `;
    
    await pool.query(query, [token, openid, timeRange, shareFutureData, expiresAt]);

    res.json({
      token,
      expiration: expiresAt.toISOString()
    });

  } catch (err: any) {
    console.error('Error generating share token:', err);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});


async function getShareData(token: string, page: number = 1, pageSize: number = 20) {
  // 1. Validate Token
  const tokenQuery = `SELECT * FROM share_tokens WHERE token = $1`;
  const tokenRes = await pool.query(tokenQuery, [token]);
  
  if (tokenRes.rows.length === 0) {
    throw { status: 404, message: 'Invalid token' };
  }

  const shareInfo = tokenRes.rows[0];
  const now = new Date();
  
  if (new Date(shareInfo.expires_at) < now) {
    throw { status: 410, message: 'Token expired' };
  }

  // 2. Fetch Records based on constraints
  let timeFilter = '';
  const params = [shareInfo.user_id];
  let paramIndex = 2;

  // Handle Time Range
  if (shareInfo.time_range !== 'all') {
    const days = parseInt(shareInfo.time_range);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    timeFilter += ` AND measured_at >= $${paramIndex}`;
    params.push(startDate.toISOString());
    paramIndex++;
  }

  // Handle Future Data Restriction
  if (!shareInfo.share_future_data) {
    timeFilter += ` AND measured_at <= $${paramIndex}`;
    params.push(shareInfo.created_at);
    paramIndex++;
  }

  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  const recordsQuery = `
    SELECT systolic, diastolic, heart_rate, measured_at, tags, note 
    FROM bp_records 
    WHERE user_id = $1 ${timeFilter}
    ORDER BY measured_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;
  params.push(limit, offset);

  const recordsRes = await pool.query(recordsQuery, params);
  
  // Get User Nickname
  const userQuery = `SELECT nickname, avatar_url FROM users WHERE openid = $1`;
  const userRes = await pool.query(userQuery, [shareInfo.user_id]);
  const userInfo = userRes.rows[0] || {};

  return {
    owner: userInfo,
    records: recordsRes.rows,
    meta: {
      timeRange: shareInfo.time_range,
      expiresAt: shareInfo.expires_at,
      page,
      pageSize,
      hasMore: recordsRes.rows.length === pageSize
    }
  };
}

// 通过 Token 获取分享的数据 (JSON)
router.get('/view/:token', shareViewLimiter, async (req: Request, res: Response) => {
  const { token } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 20;

  try {
    const data = await getShareData(token, page, pageSize);
    res.json(data);
  } catch (err: any) {
    console.error('Error viewing shared data:', err);
    if (err.status) {
      res.status(err.status).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Failed to retrieve data' });
    }
  }
});

// 通过 Token 获取分享的数据 (HTML)
router.get('/html/:token', shareViewLimiter, async (req: Request, res: Response) => {
  const { token } = req.params;

  try {
    // Initial load: Page 1, 20 records
    const { owner, records, meta } = await getShareData(token, 1, 20);
    
    // Helper functions for SSR
    function getBPLevel(sys: number, dia: number) {
      if (sys >= 180 || dia >= 110) return { label: '三级高血压', class: 'level3' };
      if (sys >= 160 || dia >= 100) return { label: '二级高血压', class: 'level2' };
      if (sys >= 140 || dia >= 90) return { label: '一级高血压', class: 'level1' };
      if (sys >= 120 || dia >= 80) return { label: '正常高值', class: 'normal-high' };
      return { label: '正常血压', class: 'normal' };
    }

    function getPeriod(date: Date) {
      const h = date.getHours();
      if (h >= 5 && h < 11) return 'morning';
      if (h >= 11 && h < 13) return 'noon';
      if (h >= 13 && h < 18) return 'afternoon';
      if (h >= 18 && h < 23) return 'evening';
      return 'night';
    }

    // Group records by date for initial render
    const groupedRecords: { [key: string]: any[] } = {};
    records.forEach(r => {
      const d = new Date(r.measured_at);
      const dateKey = `${d.getMonth() + 1}月${d.getDate()}日`;
      if (!groupedRecords[dateKey]) groupedRecords[dateKey] = [];
      groupedRecords[dateKey].push(r);
    });

    let recordsHtml = '';
    for (const [date, group] of Object.entries(groupedRecords)) {
      recordsHtml += `<div class="date-group"><div class="date-header">${date}</div>`;
      group.forEach(r => {
        const d = new Date(r.measured_at);
        const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        const period = getPeriod(d);
        const level = getBPLevel(r.systolic, r.diastolic);
        
        recordsHtml += `
        <div class="record-card">
          <div class="record-left">
            <div class="record-time">${timeStr}</div>
            <div class="record-period">${period}</div>
          </div>
          <div class="record-main">
            <div class="bp-value">${r.systolic}/${r.diastolic}</div>
            <div class="record-right">
              <span class="bp-tag ${level.class}">${level.label}</span>
              <span class="hr-value">${r.heart_rate || '--'} <span class="heart-icon">❤️</span></span>
            </div>
          </div>
        </div>`;
      });
      recordsHtml += `</div>`;
    }

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${owner.nickname || '用户'}的血压记录 - 安压宝</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f5; margin: 0; padding: 20px; color: #333; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: #fff; padding: 20px; border-radius: 12px; margin-bottom: 20px; display: flex; align-items: center; gap: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .avatar { width: 50px; height: 50px; border-radius: 50%; background: #eee; object-fit: cover; }
    .info h1 { margin: 0; font-size: 18px; }
    .meta { font-size: 12px; color: #999; margin-top: 4px; }
    
    /* Record List Styles */
    .date-group { margin-bottom: 20px; }
    .date-header { font-size: 14px; color: #666; margin-bottom: 10px; padding-left: 5px; }
    .record-card { background: #fff; border-radius: 12px; padding: 15px 20px; margin-bottom: 10px; display: flex; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .record-left { width: 60px; margin-right: 15px; }
    .record-time { font-size: 18px; font-weight: bold; color: #333; margin-bottom: 2px; }
    .record-period { font-size: 12px; color: #999; background: #f5f5f5; padding: 1px 6px; border-radius: 4px; display: inline-block; }
    .record-main { flex: 1; display: flex; justify-content: space-between; align-items: center; }
    .bp-value { font-size: 28px; font-weight: bold; color: #333; font-family: "DIN Alternate", sans-serif; }
    .record-right { display: flex; align-items: center; gap: 10px; }
    .bp-tag { font-size: 12px; padding: 2px 8px; border-radius: 10px; }
    .bp-tag.level3 { color: #cf1322; background: #fff1f0; }
    .bp-tag.level2 { color: #ff4d4f; background: #fff2f0; }
    .bp-tag.level1 { color: #fa8c16; background: #fff7e6; }
    .bp-tag.normal-high { color: #faad14; background: #fffbe6; }
    .bp-tag.normal { color: #52c41a; background: #f6ffed; }
    .hr-value { font-size: 16px; font-weight: bold; color: #333; display: flex; align-items: center; gap: 4px; }
    .heart-icon { color: #ff4d4f; font-size: 12px; }

    .empty { text-align: center; color: #999; padding: 40px; }
    .footer { text-align: center; margin-top: 40px; color: #999; font-size: 12px; }
    .loading { text-align: center; padding: 20px; color: #999; display: none; }
    
    .chart-card { background: #fff; border-radius: 12px; padding: 15px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .chart-title { font-size: 16px; font-weight: bold; color: #333; }
    .chart-legend { display: flex; gap: 10px; font-size: 12px; color: #666; }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot.high { background: #ff4d4f; }
    .dot.low { background: #1890ff; }
    .dot.hr { background: #52c41a; }

    .chart-legend-group { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
    .chart-legend-zones { display: flex; gap: 8px; font-size: 10px; color: #999; }
    .zone-item { display: flex; align-items: center; gap: 3px; }
    .zone-box { width: 8px; height: 8px; border-radius: 2px; }
    .zone-box.normal { background: rgba(82, 196, 26, 0.2); }
    .zone-box.level1 { background: rgba(250, 173, 20, 0.2); }
    .zone-box.level2 { background: rgba(255, 77, 79, 0.2); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img class="avatar" src="${owner.avatar_url || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iI2VlZSIvPjxwYXRoIGQ9Ik01MCA1MGMtMTIgMC0yMi0xMC0yMi0yMnMxMC0yMiAyMi0yMiAyMiAxMCAyMiAyMi0xMCAyMi0yMiAyMnptMCAxMGMtMjAgMC00MCAxMC00MCAzMHYxMGg4MFY5MGMwLTIwLTIwLTMwLTQwLTMweiIgZmlsbD0iI2NjYyIvPjwvc3ZnPg=='}" alt="Avatar">
      <div class="info">
        <h1>${owner.nickname || '用户'}的血压记录</h1>
        <div class="meta">有效期至: ${new Date(meta.expiresAt).toLocaleDateString()}</div>
      </div>
    </div>

    <div class="chart-card">
      <div class="chart-header">
        <div class="chart-title">血压趋势</div>
        <div class="chart-legend-group">
          <div class="chart-legend-zones">
            <span class="zone-item"><span class="zone-box normal"></span>正常</span>
            <span class="zone-item"><span class="zone-box level1"></span>一级</span>
            <span class="zone-item"><span class="zone-box level2"></span>危险</span>
          </div>
          <div class="chart-legend">
            <div class="legend-item"><span class="dot high"></span>收缩压</div>
            <div class="legend-item"><span class="dot low"></span>舒张压</div>
          </div>
        </div>
      </div>
      <div id="chartBP" style="width: 100%; height: 250px;"></div>
    </div>

    <div class="chart-card">
      <div class="chart-header">
        <div class="chart-title">心率趋势</div>
        <div class="chart-legend">
          <div class="legend-item"><span class="dot hr"></span>心率</div>
        </div>
      </div>
      <div id="chartHR" style="width: 100%; height: 200px;"></div>
    </div>

    <div class="list" id="recordList">
      ${records.length > 0 ? recordsHtml : '<div class="empty">暂无符合条件的数据</div>'}
    </div>
    <div class="loading" id="loading">加载中...</div>

    <div class="footer">
      <p>由「安压宝」提供技术支持</p>
    </div>
  </div>

  <script>
    (function() {
      var token = "${token}";
      var currentPage = 1;
      var isLoading = false;
      var hasMore = ${meta.hasMore};
      var allRecords = ${JSON.stringify(records)};
      
      // Sort oldest to newest for Chart
      allRecords.sort(function(a, b) { return new Date(a.measured_at) - new Date(b.measured_at); });

      // --- Chart Logic ---
      var myChartBP, myChartHR;
      var uniqueDays = [];
      var dayMap = {};

      function processData(records) {
        uniqueDays = [];
        dayMap = {};
        
        records.forEach(function(r) {
          var d = new Date(r.measured_at);
          var key = d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
          if (dayMap[key] === undefined) {
            dayMap[key] = uniqueDays.length;
            uniqueDays.push({
              key: key,
              label: (d.getMonth()+1) + '/' + d.getDate()
            });
          }
        });

        function getXValue(record) {
          var d = new Date(record.measured_at);
          var key = d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
          var dayIndex = dayMap[key];
          var msInDay = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * 1000 + d.getMilliseconds();
          var fraction = msInDay / 86400000;
          return dayIndex + fraction;
        }

        return {
          systolic: records.map(function(r) { return { value: [getXValue(r), r.systolic], original: r }; }),
          diastolic: records.map(function(r) { return { value: [getXValue(r), r.diastolic], original: r }; }),
          heartRate: records.map(function(r) { return { value: [getXValue(r), r.heart_rate], original: r }; })
        };
      }

      function initCharts() {
        var data = processData(allRecords);
        var totalDays = uniqueDays.length;
        var startValue = Math.max(0, totalDays - 7);

        var gridConfig = { left: '10', right: '10', bottom: '20', top: '10', containLabel: true };
        var dataZoomConfig = [{ type: 'inside', xAxisIndex: [0, 1], startValue: startValue, endValue: totalDays, zoomLock: false }];
        
        var xAxisConfig = [
          { 
            type: 'value', 
            min: 0, 
            max: totalDays, 
            interval: 1, 
            axisLabel: { show: false }, 
            axisTick: { show: false }, 
            splitLine: { show: true, lineStyle: { color: 'rgba(36, 41, 46, 0.2)' } }, 
            minorSplitLine: { show: true, splitNumber: 2, lineStyle: { type: 'dashed', color: '#f0f0f0' } } 
          },
          { 
            type: 'category', 
            data: uniqueDays.map(function(d) { return d.label; }), 
            axisTick: { show: false }, 
            axisLine: { show: false }, 
            splitLine: { show: false }, 
            axisLabel: { color: '#999', fontSize: 10, interval: 0 },
            axisPointer: { show: false } // Disable axis pointer for the label axis
          }
        ];

        function getTooltipFormatter(params) {
          if (!params || params.length === 0) return '';
          var item = params[0];
          var r = item.data.original;
          var d = new Date(r.measured_at);
          var dateStr = (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
          var html = '<div style="font-size:12px;color:#666;margin-bottom:5px;">' + dateStr + '</div>';
          params.forEach(function(p) {
            html += '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;"><div style="width:8px;height:8px;border-radius:50%;background:' + p.color + '"></div><div style="width:50px;color:#666;">' + p.seriesName + '</div><div style="font-weight:bold;">' + p.data.value[1] + '</div></div>';
          });
          return html;
        }

        // BP Chart
        myChartBP = echarts.init(document.getElementById('chartBP'));
        myChartBP.setOption({
          tooltip: { trigger: 'axis', backgroundColor: 'rgba(255, 255, 255, 0.9)', borderColor: '#eee', borderWidth: 1, textStyle: { color: '#333' }, formatter: getTooltipFormatter },
          grid: gridConfig,
          dataZoom: dataZoomConfig,
          xAxis: xAxisConfig,
          yAxis: { type: 'value', name: 'mmHg', min: function(v) { return Math.floor(v.min/10)*10-10; }, max: function(v) { return Math.ceil(v.max/10)*10+10; }, splitLine: { lineStyle: { type: 'dashed', color: '#f5f5f5' } } },
          series: [
            { name: '收缩压', type: 'line', smooth: true, symbol: 'circle', symbolSize: 8, data: data.systolic, itemStyle: { color: '#ff4d4f', borderColor: '#fff', borderWidth: 2 }, lineStyle: { width: 3, shadowColor: 'rgba(255, 77, 79, 0.3)', shadowBlur: 10 }, label: { show: true, position: 'top', color: '#333', fontSize: 10 }, markArea: { silent: true, data: [[{ yAxis: 140, itemStyle: { color: 'rgba(255, 77, 79, 0.1)' } }, { yAxis: 300 }], [{ yAxis: 120, itemStyle: { color: 'rgba(250, 173, 20, 0.1)' } }, { yAxis: 140 }], [{ yAxis: 0, itemStyle: { color: 'rgba(82, 196, 26, 0.1)' } }, { yAxis: 120 }]] } },
            { name: '舒张压', type: 'line', smooth: true, symbol: 'circle', symbolSize: 8, data: data.diastolic, itemStyle: { color: '#1890ff', borderColor: '#fff', borderWidth: 2 }, lineStyle: { width: 3, shadowColor: 'rgba(24, 144, 255, 0.3)', shadowBlur: 10 }, label: { show: true, position: 'bottom', color: '#333', fontSize: 10 } }
          ]
        });

        // HR Chart
        myChartHR = echarts.init(document.getElementById('chartHR'));
        myChartHR.setOption({
          tooltip: { trigger: 'axis', backgroundColor: 'rgba(255, 255, 255, 0.9)', borderColor: '#eee', borderWidth: 1, textStyle: { color: '#333' }, formatter: getTooltipFormatter },
          grid: gridConfig,
          dataZoom: dataZoomConfig,
          xAxis: xAxisConfig,
          yAxis: { type: 'value', name: 'bpm', min: 40, max: 120, splitLine: { lineStyle: { type: 'dashed', color: '#f5f5f5' } }, axisLabel: { color: '#999', fontSize: 10 } },
          series: [
            { name: '心率', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, data: data.heartRate, itemStyle: { color: '#faad14', borderColor: '#fff', borderWidth: 2 }, lineStyle: { width: 2, type: 'solid' }, label: { show: true, position: 'top', color: '#333', fontSize: 10 } }
          ]
        });

        echarts.connect([myChartBP, myChartHR]);
        window.addEventListener('resize', function() { myChartBP.resize(); myChartHR.resize(); });

        // Chart Lazy Load Listener
        myChartBP.on('dataZoom', function(params) {
          var opt = myChartBP.getOption();
          var start = opt.dataZoom[0].start;
          if (start < 1 && hasMore && !isLoading) {
            loadMoreData();
          }
        });
      }

      // --- List Logic ---
      function getBPLevel(sys, dia) {
        if (sys >= 180 || dia >= 110) return { label: '三级高血压', class: 'level3' };
        if (sys >= 160 || dia >= 100) return { label: '二级高血压', class: 'level2' };
        if (sys >= 140 || dia >= 90) return { label: '一级高血压', class: 'level1' };
        if (sys >= 120 || dia >= 80) return { label: '正常高值', class: 'normal-high' };
        return { label: '正常血压', class: 'normal' };
      }

      function getPeriod(date) {
        var h = date.getHours();
        if (h >= 5 && h < 11) return 'morning';
        if (h >= 11 && h < 13) return 'noon';
        if (h >= 13 && h < 18) return 'afternoon';
        if (h >= 18 && h < 23) return 'evening';
        return 'night';
      }

      function appendList(newRecords) {
        var container = document.getElementById('recordList');
        // Group new records by date
        var grouped = {};
        newRecords.forEach(function(r) {
          var d = new Date(r.measured_at);
          var key = (d.getMonth() + 1) + '月' + d.getDate() + '日';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(r);
        });

        var html = '';
        for (var date in grouped) {
          html += '<div class="date-group"><div class="date-header">' + date + '</div>';
          grouped[date].forEach(function(r) {
            var d = new Date(r.measured_at);
            var timeStr = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
            var period = getPeriod(d);
            var level = getBPLevel(r.systolic, r.diastolic);
            
            html += '<div class="record-card"><div class="record-left"><div class="record-time">' + timeStr + '</div><div class="record-period">' + period + '</div></div><div class="record-main"><div class="bp-value">' + r.systolic + '/' + r.diastolic + '</div><div class="record-right"><span class="bp-tag ' + level.class + '">' + level.label + '</span><span class="hr-value">' + (r.heart_rate || '--') + ' <span class="heart-icon">❤️</span></span></div></div></div>';
          });
          html += '</div>';
        }
        
        // Append HTML
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        while (tempDiv.firstChild) {
          container.appendChild(tempDiv.firstChild);
        }
      }

      // --- Shared Load Logic ---
      function loadMoreData() {
        if (isLoading || !hasMore) return;
        isLoading = true;
        document.getElementById('loading').style.display = 'block';

        fetch('/share/view/' + token + '?page=' + (currentPage + 1))
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.records && data.records.length > 0) {
              currentPage++;
              
              // 1. Update List (Append to bottom)
              appendList(data.records);
              
              // 2. Update Chart (Prepend to start)
              var newBatchASC = data.records.slice().sort(function(a, b) { return new Date(a.measured_at) - new Date(b.measured_at); });
              var oldDaysCount = uniqueDays.length;
              
              allRecords = newBatchASC.concat(allRecords);
              var processed = processData(allRecords);
              var newDaysCount = uniqueDays.length;
              var addedDays = newDaysCount - oldDaysCount;
              
              // Update Chart Options
              var xAxisUpdate = [
                { max: newDaysCount },
                { data: uniqueDays.map(function(d) { return d.label; }) }
              ];
              
              myChartBP.setOption({ xAxis: xAxisUpdate, series: [{ data: processed.systolic }, { data: processed.diastolic }] });
              myChartHR.setOption({ xAxis: xAxisUpdate, series: [{ data: processed.heartRate }] });
              
              // Adjust Zoom to keep view stable
              var currentZoom = myChartBP.getOption().dataZoom[0];
              myChartBP.dispatchAction({
                type: 'dataZoom',
                startValue: currentZoom.startValue + addedDays,
                endValue: currentZoom.endValue + addedDays
              });
              
              if (!data.meta.hasMore) hasMore = false;
            } else {
              hasMore = false;
            }
            isLoading = false;
            document.getElementById('loading').style.display = 'none';
          })
          .catch(function(err) {
            console.error(err);
            isLoading = false;
            document.getElementById('loading').style.display = 'none';
          });
      }

      // Init
      initCharts();

      // List Scroll Listener
      window.addEventListener('scroll', function() {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100) {
          loadMoreData();
        }
      });

    })();
  </script>
</body>
</html>
    `;

    res.send(html);

  } catch (err: any) {
    console.error('Error viewing shared html:', err);
    if (err.status) {
      res.status(err.status).send(`<h1>${err.message}</h1>`);
    } else {
      res.status(500).send('<h1>无法加载分享数据</h1>');
    }
  }
});

export default router;

Page({
  data: {},

  handleRecord() {
    wx.navigateTo({
      url: '/pages/record/record'
    });
  },

  handleHistory() {
    wx.navigateTo({
      url: '/pages/history/history'
    });
  }
});

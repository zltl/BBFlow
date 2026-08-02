import { API_ENDPOINTS } from '../../config';
import { generateIdempotencyKey } from '../../utils/idempotency';
import { request } from '../../utils/request';

interface PlanItem {
  id: number;
  name: string;
  description: string;
  price_cents: number;
  duration_days: number;
  max_records: number;
  features: string;
  priceText?: string;
  durationText?: string;
}

interface SubscriptionHistoryItem {
  id: number;
  plan: string;
  starts_at: string;
  expires_at: string;
  status: string;
  startsAtText?: string;
  expiresAtText?: string;
}

interface OrderItem {
  id: number;
  order_no: string;
  amount_cents: number;
  status: string;
  created_at: string;
  paid_at?: string;
  plan: string;
  amountText?: string;
  createdAtText?: string;
  statusLabel?: string;
}

interface PaymentParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  closed: '已关闭',
  refunded: '已退款',
};

Page({
  data: {
    isLoading: false,
    loadError: '',
    creatingPlanId: 0,
    plans: [] as PlanItem[],
    subscription: {
      is_active: false,
      paid_until: '',
      history: [] as SubscriptionHistoryItem[],
    },
    orders: [] as OrderItem[],
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    this.setData({ isLoading: true, loadError: '' });
    try {
      const [plansRes, subscriptionRes, ordersRes] = await Promise.all([
        request<{ plans: PlanItem[] }>({ url: API_ENDPOINTS.PLANS, method: 'GET', showError: false }),
        request<any>({ url: API_ENDPOINTS.PAYMENT_SUBSCRIPTION, method: 'GET', showError: false }),
        request<{ orders: OrderItem[] }>({ url: API_ENDPOINTS.PAYMENT_ORDERS, method: 'GET', showError: false }),
      ]);

      this.setData({
        plans: (plansRes.plans || []).map((item) => ({
          ...item,
          priceText: this.formatPrice(item.price_cents),
          durationText: `${item.duration_days} 天`,
        })),
        subscription: {
          is_active: subscriptionRes.is_active || false,
          paid_until: subscriptionRes.paid_until ? this.formatDate(subscriptionRes.paid_until) : '',
          history: (subscriptionRes.history || []).map((item: SubscriptionHistoryItem) => ({
            ...item,
            startsAtText: this.formatDate(item.starts_at),
            expiresAtText: this.formatDate(item.expires_at),
          })),
        },
        orders: (ordersRes.orders || []).map((item) => ({
          ...item,
          amountText: this.formatPrice(item.amount_cents),
          createdAtText: this.formatDate(item.created_at),
          statusLabel: STATUS_LABELS[item.status] || item.status,
        })),
        loadError: '',
      });
    } catch (error) {
      console.error('Failed to load subscription data', error);
      this.setData({ loadError: '会员数据加载失败，点此重试' });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  async createOrder(e: WechatMiniprogram.TouchEvent) {
    const planId = Number(e.currentTarget.dataset.planId);
    if (!planId) return;

    this.setData({ creatingPlanId: planId });
    try {
      const res = await request<{
        order_id: number;
        order_no: string;
        amount_cents: number;
        plan_name: string;
        message: string;
        payment_ready?: boolean;
        payment?: PaymentParams;
      }>({
        url: API_ENDPOINTS.PAYMENT_ORDER,
        method: 'POST',
        data: { plan_id: planId },
        idempotencyKey: generateIdempotencyKey('payment-order'),
      });

      if (res.payment && res.payment_ready) {
        await this.invokeWxPay(res.payment, res.order_no);
      } else {
        wx.showModal({
          title: '订单已创建',
          content: `套餐：${res.plan_name}\n订单号：${res.order_no}\n金额：${this.formatPrice(res.amount_cents)}\n\n${res.message || '请完成支付。若尚未开通微信支付，请联系管理员确认订单。'}`,
          showCancel: false,
        });
      }
      this.loadData();
    } catch (error) {
      console.error('Failed to create payment order', error);
    } finally {
      this.setData({ creatingPlanId: 0 });
    }
  },

  invokeWxPay(payment: PaymentParams, orderNo: string): Promise<void> {
    return new Promise((resolve) => {
      wx.requestPayment({
        timeStamp: payment.timeStamp,
        nonceStr: payment.nonceStr,
        package: payment.package,
        signType: payment.signType as 'MD5' | 'RSA',
        paySign: payment.paySign,
        success: () => {
          wx.showToast({ title: '支付成功', icon: 'success' });
          resolve();
        },
        fail: (err) => {
          const msg = (err && (err as any).errMsg) || '';
          if (/cancel/i.test(msg)) {
            wx.showToast({ title: '已取消支付', icon: 'none' });
          } else {
            wx.showModal({
              title: '支付未完成',
              content: `订单 ${orderNo} 仍为待支付，可稍后在订单列表重试或联系客服。`,
              showCancel: false,
            });
          }
          resolve();
        },
      });
    });
  },

  async closeOrder(e: WechatMiniprogram.TouchEvent) {
    const orderNo = e.currentTarget.dataset.orderNo as string;
    if (!orderNo) return;
    try {
      await request({
        url: `${API_ENDPOINTS.PAYMENT_ORDERS}/${orderNo}/close`,
        method: 'POST',
      });
      wx.showToast({ title: '订单已关闭', icon: 'success' });
      this.loadData();
    } catch (error) {
      console.error('Failed to close order', error);
    }
  },

  async retryPay(e: WechatMiniprogram.TouchEvent) {
    // Re-create flow: user picks plan again; pending orders can be closed first
    const planId = Number(e.currentTarget.dataset.planId);
    if (planId) {
      this.createOrder({ currentTarget: { dataset: { planId } } } as any);
      return;
    }
    wx.showToast({ title: '请选择套餐重新下单', icon: 'none' });
  },

  formatPrice(priceCents: number) {
    return `¥${(priceCents / 100).toFixed(2)}`;
  },

  formatDate(value?: string) {
    if (!value) return '未开通';
    return new Date(value).toLocaleDateString();
  },
});

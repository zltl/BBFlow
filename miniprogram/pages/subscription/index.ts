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
}

Page({
  data: {
    isLoading: false,
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
    this.setData({ isLoading: true });
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
        })),
      });
    } catch (error) {
      console.error('Failed to load subscription data', error);
    } finally {
      this.setData({ isLoading: false });
    }
  },

  async createOrder(e: WechatMiniprogram.TouchEvent) {
    const planId = Number(e.currentTarget.dataset.planId);
    if (!planId) return;

    this.setData({ creatingPlanId: planId });
    try {
      const res = await request<{ order_id: number; order_no: string; amount_cents: number; plan_name: string; message: string }>({
        url: API_ENDPOINTS.PAYMENT_ORDER,
        method: 'POST',
        data: { plan_id: planId },
        idempotencyKey: generateIdempotencyKey('payment-order'),
      });

      wx.showModal({
        title: '订单已创建',
        content: `套餐：${res.plan_name}\n订单号：${res.order_no}\n金额：${this.formatPrice(res.amount_cents)}\n\n当前版本已打通订单与订阅展示，微信支付签名参数待后端联调后接入。`,
        showCancel: false,
      });
      this.loadData();
    } catch (error) {
      console.error('Failed to create payment order', error);
    } finally {
      this.setData({ creatingPlanId: 0 });
    }
  },

  formatPrice(priceCents: number) {
    return `¥${(priceCents / 100).toFixed(2)}`;
  },

  formatDate(value?: string) {
    if (!value) return '未开通';
    return new Date(value).toLocaleDateString();
  },
});

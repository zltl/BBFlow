export const generateIdempotencyKey = (prefix: string = 'req') => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
};

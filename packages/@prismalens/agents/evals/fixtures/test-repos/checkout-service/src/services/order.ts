import { Order, Customer } from '../models';

export interface ProcessOrderInput {
  orderId: string;
  items: OrderItem[];
  customer?: Customer; // Optional - not set for API orders
}

export class OrderService {
  async processOrder(order: ProcessOrderInput): Promise<OrderResult> {
    // Validate order
    if (!order.items?.length) {
      throw new Error('Order must have items');
    }

    // BUG: customer can be undefined for API orders
    const customerId = order.customer.id;  // Line 87 - TypeError here!

    // Process payment
    await this.paymentService.charge(customerId, this.calculateTotal(order));

    // Create order record
    return this.createOrderRecord(order, customerId);
  }
}

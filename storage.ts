import { type Category, type Product, type CartItem, type InsertProduct, type InsertCategory, type InsertCartItem, type User, type InsertUser, type Order, type OrderItem, type InsertOrder, type InsertOrderItem } from "@shared/schema";
import { categories, products, cartItems, users, orders, orderItems } from "@shared/schema";
import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  getCategories(): Promise<Category[]>;
  getCategory(slug: string): Promise<Category | undefined>;
  getCategoryById(id: number): Promise<Category | undefined>;
  getProducts(): Promise<Product[]>;
  getProduct(slug: string): Promise<Product | undefined>;
  getProductById(id: number): Promise<Product | undefined>;
  getProductsByCategory(categoryId: number): Promise<Product[]>;
  getCartItems(cartId: string): Promise<(CartItem & { product: Product })[]>;
  addCartItem(item: InsertCartItem): Promise<CartItem>;
  updateCartItemQuantity(id: number, quantity: number): Promise<CartItem>;
  removeCartItem(id: number): Promise<void>;
  searchProducts(query: string): Promise<Product[]>;
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  // Add order-related methods
  createOrder(order: InsertOrder): Promise<Order>;
  addOrderItems(items: InsertOrderItem[]): Promise<OrderItem[]>;
  getUserOrders(userId: number): Promise<(Order & { items: (OrderItem & { product: Product })[] })[]>;
  getOrder(id: number): Promise<(Order & { items: (OrderItem & { product: Product })[] }) | undefined>;
  updateOrderStatus(id: number, status: string): Promise<Order>;
  sessionStore: session.Store;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({
      pool: db.$client,
      createTableIfMissing: true,
    });
  }

  async getCategories(): Promise<Category[]> {
    return await db.select().from(categories);
  }

  async getCategory(slug: string): Promise<Category | undefined> {
    const [category] = await db.select().from(categories).where(eq(categories.slug, slug));
    return category;
  }

  async getCategoryById(id: number): Promise<Category | undefined> {
    const [category] = await db.select().from(categories).where(eq(categories.id, id));
    return category;
  }

  async getProducts(): Promise<Product[]> {
    return await db.select().from(products);
  }

  async getProduct(slug: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.slug, slug));
    return product;
  }

  async getProductById(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async getProductsByCategory(categoryId: number): Promise<Product[]> {
    return await db.select().from(products).where(eq(products.categoryId, categoryId));
  }

  async getCartItems(cartId: string): Promise<(CartItem & { product: Product })[]> {
    const items = await db
      .select({
        cartItem: cartItems,
        product: products,
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(eq(cartItems.cartId, cartId));

    return items.map(({ cartItem, product }) => ({
      ...cartItem,
      product,
    }));
  }

  async addCartItem(item: InsertCartItem): Promise<CartItem> {
    const [cartItem] = await db.insert(cartItems).values(item).returning();
    return cartItem;
  }

  async updateCartItemQuantity(id: number, quantity: number): Promise<CartItem> {
    const [cartItem] = await db
      .update(cartItems)
      .set({ quantity })
      .where(eq(cartItems.id, id))
      .returning();
    return cartItem;
  }

  async removeCartItem(id: number): Promise<void> {
    await db.delete(cartItems).where(eq(cartItems.id, id));
  }

  async searchProducts(query: string): Promise<Product[]> {
    const searchTerm = `%${query.toLowerCase()}%`;
    return await db
      .select()
      .from(products)
      .where(
        sql`LOWER(name) LIKE ${searchTerm} OR LOWER(description) LIKE ${searchTerm}`
      );
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async createOrder(order: InsertOrder): Promise<Order> {
    try {
      const [newOrder] = await db.insert(orders).values(order).returning();
      return newOrder;
    } catch (error) {
      console.error('Error creating order:', error);
      throw error;
    }
  }

  async addOrderItems(items: InsertOrderItem[]): Promise<OrderItem[]> {
    try {
      return await db.insert(orderItems).values(items).returning();
    } catch (error) {
      console.error('Error adding order items:', error);
      throw error;
    }
  }

  async getUserOrders(userId: number): Promise<(Order & { items: (OrderItem & { product: Product })[] })[]> {
    const userOrders = await db.select().from(orders).where(eq(orders.userId, userId));

    const ordersWithItems = await Promise.all(
      userOrders.map(async (order) => {
        const items = await db
          .select({
            orderItem: orderItems,
            product: products,
          })
          .from(orderItems)
          .innerJoin(products, eq(orderItems.productId, products.id))
          .where(eq(orderItems.orderId, order.id));

        return {
          ...order,
          items: items.map(({ orderItem, product }) => ({
            ...orderItem,
            product,
          })),
        };
      })
    );

    return ordersWithItems;
  }

  async getOrder(id: number): Promise<(Order & { items: (OrderItem & { product: Product })[] }) | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    if (!order) return undefined;

    const items = await db
      .select({
        orderItem: orderItems,
        product: products,
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, id));

    return {
      ...order,
      items: items.map(({ orderItem, product }) => ({
        ...orderItem,
        product,
      })),
    };
  }

  async updateOrderStatus(id: number, status: string): Promise<Order> {
    const [order] = await db
      .update(orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    return order;
  }
}

export const storage = new DatabaseStorage();
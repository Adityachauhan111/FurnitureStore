import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCartItemSchema, insertOrderSchema, insertOrderItemSchema } from "@shared/schema";
import { z } from "zod";
import { setupAuth } from "./auth";

export function registerRoutes(app: Express): Server {
  // Set up authentication routes and middleware
  setupAuth(app);

  // Existing routes
  app.get("/api/categories", async (req, res) => {
    const categories = await storage.getCategories();
    res.json(categories);
  });

  app.get("/api/categories/:slug", async (req, res) => {
    const category = await storage.getCategory(req.params.slug);
    if (!category) return res.status(404).json({ message: "Category not found" });
    const products = await storage.getProductsByCategory(category.id);
    res.json({ category, products });
  });

  app.get("/api/products", async (req, res) => {
    const products = await storage.getProducts();
    res.json(products);
  });

  app.get("/api/products/search", async (req, res) => {
    const query = req.query.q as string;
    if (!query) return res.json([]);
    const products = await storage.searchProducts(query);
    res.json(products);
  });

  app.get("/api/products/:slug", async (req, res) => {
    const product = await storage.getProduct(req.params.slug);
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  });

  app.get("/api/cart/:cartId", async (req, res) => {
    const items = await storage.getCartItems(req.params.cartId);
    res.json(items);
  });

  app.post("/api/cart/:cartId/items", async (req, res) => {
    const cartId = req.params.cartId;
    const result = insertCartItemSchema.safeParse({ ...req.body, cartId });
    if (!result.success) {
      return res.status(400).json({ message: "Invalid cart item data" });
    }
    const item = await storage.addCartItem(result.data);
    res.status(201).json(item);
  });

  app.patch("/api/cart/items/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const quantity = z.number().min(1).parse(req.body.quantity);
    const item = await storage.updateCartItemQuantity(id, quantity);
    res.json(item);
  });

  app.delete("/api/cart/items/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.removeCartItem(id);
    res.status(204).send();
  });

  // Order management routes
  app.post("/api/orders", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      let cartItems;
      if (req.body.buyNow) {
        // Handle "Buy Now" - create order directly from product
        const product = await storage.getProductById(req.body.productId);
        if (!product) {
          return res.status(404).json({ message: "Product not found" });
        }
        cartItems = [{
          product,
          quantity: req.body.quantity
        }];
      } else {
        // Handle cart checkout
        const cartId = req.body.cartId;
        cartItems = await storage.getCartItems(cartId);
        if (!cartItems.length) {
          return res.status(400).json({ message: "Cart is empty" });
        }
      }

      const totalAmount = cartItems.reduce(
        (sum, item) => sum + Number(item.product.price) * item.quantity,
        0
      );

      const order = await storage.createOrder({
        userId: req.user.id,
        totalAmount: totalAmount.toString(),
        status: "pending"
      });

      const orderItems = await storage.addOrderItems(
        cartItems.map((item) => ({
          orderId: order.id,
          productId: item.product.id,
          quantity: item.quantity,
          price: item.product.price
        }))
      );

      // Clear the cart only if it's a cart checkout
      if (!req.body.buyNow && req.body.cartId) {
        await Promise.all(cartItems.map((item) => storage.removeCartItem(item.id)));
      }

      const orderWithItems = await storage.getOrder(order.id);
      res.status(201).json(orderWithItems);
    } catch (error) {
      console.error('Error creating order:', error);
      res.status(500).json({ message: "Failed to create order" });
    }
  });

  app.get("/api/orders", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const orders = await storage.getUserOrders(req.user.id);
    res.json(orders);
  });

  app.get("/api/orders/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const order = await storage.getOrder(parseInt(req.params.id));
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) return res.sendStatus(403);
    res.json(order);
  });

  app.patch("/api/orders/:id/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const order = await storage.getOrder(parseInt(req.params.id));
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) return res.sendStatus(403);

    const status = z.string().parse(req.body.status);
    const updatedOrder = await storage.updateOrderStatus(order.id, status);
    res.json(updatedOrder);
  });

  const httpServer = createServer(app);
  return httpServer;
}
# NearXpirY
NearXpirY is a "Save More, Waste Less" platform connecting sellers, customers, and NGOs around near-expiry products. Sellers list soon-to-expire stock, customers buy it at discounts, and NGOs redistribute surplus to those in need — reducing waste while saving money and supporting communities.
NearXpirY 
Save More, Waste Less
A multi-role web platform connecting Sellers, Customers, and NGOs around near-expiry products — reducing waste while saving money and supporting communities.
 Roles
Customer – Browse & buy discounted near-expiry products

Seller – List near-expiry inventory, view claims, and donate surplus stock

NGO – Claim donated products and redistribute them to those in need

Key Features
Role-based login & signup system

Real-time product search by name and category

Cart & order management with live stock tracking

Auto-donation system — products expiring in ≤7 days are automatically donated to NGOs

Sellers can manually donate products to NGOs at any time

Each role gets a personalized dashboard after login

Tech Stack
Frontend: HTML, CSS, JavaScript

Backend: Node.js (built-in http module, no Express)

Database: MongoDB (local)

Auth: SHA-256 password hashing with salt (Node.js crypto module)

Run Locally
Clone the repo

Run npm install

Make sure MongoDB is running locally on port 27017

Run node server.js

Open http://localhost:3000 in your browser

 User Workflow
Customers — Sign up, browse products by category, search, add to cart, and place orders

Sellers — Sign up, upload near-expiry products, view customer claims, and donate surplus

NGOs — Sign up, view available donations, claim them, and track coordinated distributions

Mission
NearXpirY was built to tackle the real-world problem of product expiry waste. By connecting sellers, buyers, and charitable organizations on one platform, we create a win-win-win — sellers recover value, customers save money, and NGOs get resources to help communities in need.


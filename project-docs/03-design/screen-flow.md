# Screen Flow

## Website (`web`) — all routes prefixed with `/[locale]` (`ar` default | `en`)

```mermaid
flowchart LR
  Home --> Shop
  Home --> Category[/category/:slug/]
  Shop --> PDP[/product/:slug/]
  Category --> PDP
  PDP --> CartDrawer
  CartDrawer --> Cart[/cart/]
  Cart --> Checkout[/checkout/]
  Checkout -->|not logged in| Login[/auth/login/]
  Login --> Register[/auth/register/]
  Register --> VerifyOTP[/auth/verify/]
  Login --> Forgot[/auth/forgot/] --> Reset[/auth/reset/]
  VerifyOTP --> Checkout
  Checkout --> Success[/order/success/:no/]
  Success --> MyOrder[/account/orders/:id/]
  Account[/account/] --> Profile & Addresses & Orders[/account/orders/] & Notifications[/account/notifications/]
  Home --> Pages[/pages/:slug/ about, faq, terms, privacy, contact]
```

## Admin (`admin`) — `/login`, then sidebar layout

```
/login → /verify (first login or new admin)
/            Overview
/products    List → /products/new, /products/:id
/categories  List + dialog edit
/orders      List → /orders/:id (status, note, invoice print)
/customers   List → /customers/:id
/content/banners    List + editor
/content/sections   Drag-sort list + config sheet
/content/pages      List → /content/pages/:id
/settings           Tabs: General · Delivery · VAT · Social · SEO
/admins             List + invite
/notifications      Full list
```

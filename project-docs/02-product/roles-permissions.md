# Roles & Permissions

| Capability | Guest | CUSTOMER | ADMIN |
|---|:-:|:-:|:-:|
| Browse catalog, CMS pages | ✓ | ✓ | ✓ |
| Guest cart (localStorage) | ✓ | – | – |
| Server cart, checkout (COD) | – | ✓ | – |
| Own profile, addresses, orders | – | ✓ | – |
| Cancel own `PENDING` order | – | ✓ | – |
| Own notifications (live + list) | – | ✓ | ✓ |
| Admin dashboard access | – | – | ✓ |
| Products / categories CRUD | – | – | ✓ |
| Orders: view all, change status | – | – | ✓ |
| Customers: view, block | – | – | ✓ |
| CMS: banners, sections, pages, settings | – | – | ✓ |
| Create admin users | – | – | ✓ |

Enforcement: `requireAuth` + `requireRole('ADMIN')` middleware on `/api/v1/admin/*`. Socket.IO connections authenticated with the access token; customers join room `user:{id}`, admins also join `admins`.

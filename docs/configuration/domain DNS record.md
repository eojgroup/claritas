# DNS Configuration for Claritas Web App

This document describes the manual DNS configuration required to expose the **Claritas web application** (`app.claritas.info`) through Google Kubernetes Engine (GKE) Ingress.

---

## 📌 Domain

- **Domain Registrar / DNS Host:** Microsoft 365 Admin Center  
- **Root Domain:** `claritas.info`  
- **Subdomain for Web Application:** `app.claritas.info`  

---

## 🔹 DNS Record Created

| Record Type | Hostname / Alias | Value (Target) | TTL    | Purpose                           |
|-------------|------------------|----------------|--------|-----------------------------------|
| `A`         | `app`            | `35.190.65.41` | 1 Hour | Points `app.claritas.info` to the external IP of the GKE Ingress |

---

## 🔹 How It Works

1. The GKE Ingress (`claritas`) provisions a **Google Cloud Load Balancer** with an external IP address (`35.190.65.41`).
2. A DNS `A` record was created in Microsoft 365 Admin Center:
   - **Hostname:** `app`  
   - **Type:** `A` (Address)  
   - **Points to:** `35.190.65.41`  
3. As a result, requests to **`app.claritas.info`** resolve to the load balancer IP and are routed to the Claritas web app (frontend) and API services via Kubernetes Ingress.

---

## 🔹 Certificate

- A **ManagedCertificate** (`claritas-web-cert`) is configured in GKE for `app.claritas.info`.
- Once DNS is propagated and points correctly, Google will issue and attach a TLS certificate automatically.
- You can check the status with:

```bash
kubectl -n claritas describe managedcertificate claritas-web-cert
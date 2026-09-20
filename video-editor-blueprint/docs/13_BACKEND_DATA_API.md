# 13 — Backend, Veri Modeli ve API Tasarımı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Ne zaman backend gerekir?

Yerel alfa için medya sunucusu veya kullanıcı hesabı zorunlu değildir. P3'te satın alma hakkını doğrulama, hesaplar arası tutarlı erişim, cloud job ve kota defteri gerekir. Bu hizmetler tek FastAPI modüler monolitinde başlayabilir; video encode HTTP request içinde çalışmaz.

## Kimlik

Güvenilir bir yönetilen OIDC/e-posta bağlantısı sağlayıcısı seç; şifre sıfırlama ve oturum güvenliğini sıfırdan yazma. Mobil/web için tek `account_id`, sağlayıcı `subject` eşlemesi; görünen e-posta adresini değişmez kullanıcı ID'si sayma. Hesap bağlama iki hesabın da doğrulanmasını gerektirir.

Yerel projeler guest olarak kalabilir. Satın alma/cloud için giriş gerekir; giriş yapmak medyayı otomatik yüklemez. Cihazdaki projeyi hesaba bağlama yalnızca yerel sahiplik ilişkisi kurar; kalıcı senkronizasyon değildir.

Web oturumunda secure/HttpOnly cookie ve CSRF koruması veya uygun güvenli OIDC istemci modeli seçilip ADR'ye yazılır. Mobil token OS secure storage'da; servis anahtarı istemcide asla bulunmaz.

## İlişkisel model

| Tablo | Temel alanlar / zorunlu invariant |
|---|---|
| accounts | id, status, created_at, deletion_requested_at |
| auth_identities | account_id, provider, subject; provider+subject unique |
| provider_customers | account_id, provider, provider_customer_id; doğrulanmış eşleme |
| subscriptions | account_id, provider, external_id, product, paid_through, renew_state, environment |
| entitlement_snapshots | account_id, entitlement, source_version, valid_until, verified_at |
| quota_grants | account_id, bucket, window_start/end, granted_seconds, policy_version |
| reservations | account_id, grant_id, job_id, reserved_seconds, state, expires_at; job unique |
| usage_events | immutable event_id, job_id, type, seconds, actor, idempotency_key |
| uploads/assets | owner_id, private_object_key, bytes, probe, state, expires_at |
| render_jobs | owner_id, recipe_revision/hash, state, attempt_count, lease_epoch, output_key |
| webhook_inbox | provider+event_id unique, payload_hash, received_at, verified_status |
| outbox | durable event, retry_at, processed_at |
| audit_events | sınırlı metadata; medya/secret yok; erişim ve retention kontrollü |

`available = grant - committed - active_reserved`. Bu hesap transaction içinde tutarlıdır. Bir job için iki başarılı `commit` kaydı oluşturulamaz. Para iadesi ile kota iadesi ayrı kavramdır; support manuel ayarlamaları gerekçe ve aktörle kaydeder.

## API yüzeyi — önerilen sözleşme

| Endpoint | Davranış |
|---|---|
| GET /v1/policy | Sürümlü plan/rota limitleri; yerel cache için public, secret yok |
| GET /v1/me/entitlements | Doğrulanmış plan, kaynak, süre, offline token |
| GET /v1/me/usage | Mevcut dönem, grant/reserved/used/available; saniye birimi |
| POST /v1/uploads | Owner/kota/byte tipi kontrolü; kısa ömürlü upload oturumu |
| POST /v1/uploads/{id}/complete | Gerçek object kontrolü ve probe işini tetikler |
| POST /v1/export-quotes | Ready asset + EDL doğrular, süre/kota/rota quote'u verir |
| POST /v1/render-jobs | Quote + idempotency key; atomik reserve ve durable outbox |
| GET /v1/render-jobs/{id} | Owner-only durum ve doğrulanmış geçici download erişimi |
| POST /v1/render-jobs/{id}/cancel | İdempotent iptal isteği; terminal state'i ezmez |
| GET /v1/render-jobs | Owner-only cursor pagination; media içeriği dönmez |
| POST /v1/billing/sync | Kullanıcı satın alma sonrası server refresh isteği; tek başına Pro vermez |
| POST /v1/webhooks/{provider} | Sağlayıcı doğrulaması; authenticated user endpoint'i değildir |
| POST /v1/account-deletion | Yeniden doğrulama; işlemleri durdur, silme talebi yarat |

Quote örneği:

```json
{
  "quoteId": "q_example",
  "policyVersion": "2026-09-19.v1",
  "recipeRevision": 3,
  "route": "cloud",
  "billableSeconds": 10,
  "remainingSecondsBeforeReservation": 180,
  "expiresInSeconds": 300,
  "requiresUploadConsent": true
}
```

Bu örnek gerçek quote değildir; kimlikler sentetiktir. Quote gizli yetki yerine geçmez: job oluştururken hesap, asset ownership, active grant ve süre yeniden kontrol edilir. EDL değişirse yeni quote gerekir.

## İdempotency ve transaction

`Idempotency-Key` owner+endpoint bağlamında saklanır. Aynı key+aynı body önceki sonucu döndürür; aynı key+farklı body `409 IDEMPOTENCY_CONFLICT`. “Network kesildi” durumunda istemci yeni key ile tekrar satın alma/job başlatmaz.

Job oluşturma: quota satırını kilitle → policy/available denetle → reservation+job+outbox aynı transaction'da → commit → publisher enqueue. Queue gönderimi başarısızsa outbox yeniden denenir; kota sonsuza dek bloklanmaz. Harici sağlayıcı API çağrıları DB transaction'ı boyunca uzun süre kilit tutulmasına neden olmamalı.

## Hata şeması

```json
{
  "error": {
    "code": "QUOTA_INSUFFICIENT",
    "messageKey": "cloud.quota_insufficient",
    "retryable": false,
    "correlationId": "req_example",
    "details": {"neededSeconds": 42, "availableSeconds": 30}
  }
}
```

HTTP ayrımı: 401 kimlik; 403 yetki; 404 owner'a görünmeyen/olmayan kaynak; 409 durum/idempotency; 413 boyut; 422 tarif/codec; 429 hız; 503 geçici kapasite. Raw FFmpeg stderr, path, SQL veya sağlayıcı secret'ı kullanıcıya dönmez.

## Operasyon ve güvenlik kabulü

Owner check her asset/job/download aşamasında; rate limit per account ve yardımcı IP sinyali; migration geri dönüş planı; DB restore tatbikatı; webhook ve usage reconciliation görevleri. OpenAPI koddan üretilecek ve contract testleriyle karşılaştırılacak; bu MD gerçek çalışan API iddiası değildir.

# CloudFront CORS Configuration

## Problem
Images are being blocked by CORS when trying to download from CloudFront. The error shows:
```
Access to fetch at 'https://d2cjbd1iqkwr9j.cloudfront.net/...' from origin 'https://ctomemes.xyz' 
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

## Solution: Configure CORS on CloudFront

### Step 1: Configure S3 Bucket CORS

1. Go to AWS S3 Console → `ctom-bucket-backup`
2. Click **Permissions** tab
3. Scroll to **Cross-origin resource sharing (CORS)**
4. Click **Edit** and paste this configuration:

```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "GET",
            "HEAD"
        ],
        "AllowedOrigins": [
            "https://ctomemes.xyz",
            "http://localhost:3000"
        ],
        "ExposeHeaders": [
            "Content-Length",
            "Content-Type",
            "ETag",
            "Last-Modified"
        ],
        "MaxAgeSeconds": 3000
    }
]
```

5. Click **Save changes**

### Step 2: Configure CloudFront Response Headers Policy

1. Go to AWS CloudFront Console
2. Find your distribution: `E2HZU2DDXZMH23` (d2cjbd1iqkwr9j.cloudfront.net)
3. Go to **Policies** → **Response headers policies**
4. Click **Create response headers policy**
5. Configure:
   - **Name**: `ctomemes-cors-policy`
   - **CORS settings**:
     - **Access-Control-Allow-Origin**: `https://ctomemes.xyz, http://localhost:3000`
     - **Access-Control-Allow-Methods**: `GET, HEAD`
     - **Access-Control-Allow-Headers**: `*`
     - **Access-Control-Max-Age**: `3000`
     - **Access-Control-Expose-Headers**: `Content-Length, Content-Type, ETag, Last-Modified`
     - **Origin override**: Leave unchecked (use origin header)
6. Click **Create policy**

### Step 3: Attach Policy to CloudFront Distribution

1. Go back to your CloudFront distribution
2. Click **Behaviors** tab
3. Select the default behavior (or create/edit behavior for `/*`)
4. Scroll to **Response headers policy**
5. Select `ctomemes-cors-policy` from dropdown
6. Click **Save changes**
7. **Wait 5-10 minutes** for CloudFront to propagate changes

### Step 4: Invalidate CloudFront Cache (Optional but Recommended)

1. Go to CloudFront distribution
2. Click **Invalidations** tab
3. Click **Create invalidation**
4. Enter paths: `/*`
5. Click **Create invalidation**
6. Wait for status to show **Completed**

## Alternative: Use CloudFront Function (Faster)

If you want immediate CORS without waiting for cache propagation:

1. Go to CloudFront → **Functions**
2. Click **Create function**
3. Name: `add-cors-headers`
4. Paste this code:

```javascript
function handler(event) {
    var response = event.response;
    var headers = response.headers;
    
    // Add CORS headers
    headers['access-control-allow-origin'] = { 
        value: event.request.headers.origin ? event.request.headers.origin.value : 'https://ctomemes.xyz' 
    };
    headers['access-control-allow-methods'] = { value: 'GET, HEAD' };
    headers['access-control-allow-headers'] = { value: '*' };
    headers['access-control-max-age'] = { value: '3000' };
    headers['access-control-expose-headers'] = { value: 'Content-Length, Content-Type, ETag, Last-Modified' };
    
    return response;
}
```

5. Click **Publish**
6. Go to your distribution → **Behaviors** → Edit default behavior
7. Scroll to **CloudFront Functions**
8. Select **Viewer response** → Choose `add-cors-headers`
9. Click **Save changes**

## Testing

After configuration, test by:
1. Opening browser console on https://ctomemes.xyz
2. Trying to download an image
3. Check Network tab - should see `Access-Control-Allow-Origin` header in response
4. No more CORS errors in console

## Notes

- CloudFront caches responses, so changes may take 5-10 minutes to propagate
- Use CloudFront Functions for immediate effect (no cache wait)
- S3 CORS is required even when using CloudFront (CloudFront forwards origin headers)


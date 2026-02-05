#!/bin/bash
# Deploy Pupil Detection Service to Google Cloud Run
#
# Prerequisites:
#   1. Google Cloud SDK installed (gcloud)
#   2. A GCP project with Cloud Run API enabled
#   3. Trained model placed in cloud/model/pupil_segnet/
#
# Usage:
#   ./deploy.sh <PROJECT_ID> [REGION]

set -euo pipefail

PROJECT_ID="${1:?Usage: ./deploy.sh <PROJECT_ID> [REGION]}"
REGION="${2:-us-central1}"
SERVICE_NAME="pupil-detection"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "=== Pupil Detection Service Deployment ==="
echo "Project: ${PROJECT_ID}"
echo "Region:  ${REGION}"
echo "Image:   ${IMAGE_NAME}"
echo ""

# Check model exists
if [ ! -d "model/pupil_segnet" ]; then
    echo "ERROR: Model not found at cloud/model/pupil_segnet/"
    echo "Run the training notebook first and place the exported SavedModel here."
    exit 1
fi

# Set project
gcloud config set project "${PROJECT_ID}"

# Build and push Docker image
echo "Building Docker image..."
gcloud builds submit --tag "${IMAGE_NAME}" .

# Deploy to Cloud Run
echo "Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
    --image "${IMAGE_NAME}" \
    --region "${REGION}" \
    --platform managed \
    --memory 2Gi \
    --cpu 2 \
    --timeout 30 \
    --concurrency 10 \
    --min-instances 0 \
    --max-instances 5 \
    --allow-unauthenticated \
    --set-env-vars "MODEL_PATH=./model/pupil_segnet"

# Get service URL
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --region "${REGION}" \
    --format "value(status.url)")

echo ""
echo "=== Deployment Complete ==="
echo "Service URL: ${SERVICE_URL}"
echo ""
echo "Test with:"
echo "  curl ${SERVICE_URL}/health"
echo ""
echo "Update your PWA with this endpoint URL:"
echo "  CLOUD_DETECT_URL = '${SERVICE_URL}/detect/base64'"

gcloud config set project claritas-457808
gcloud container clusters get-credentials claritas-cluster --region europe-west2 --project claritas-457808

kubectl -n claritas create secret generic claritas-db \
  --from-literal=DB_NAME=claritas \
  --from-literal=DB_USER=claritas_app \
  --from-literal=DB_PASSWORD='123' \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n claritas rollout restart deploy/claritas-api
kubectl -n claritas rollout status deploy/claritas-api --timeout=300s

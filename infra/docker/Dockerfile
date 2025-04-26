FROM node:18 AS builder

# Set the working directory inside the container
WORKDIR /app

# Copy package.json files to the working directory
COPY ./apps/web/package*.json ./

# Install the dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Build the app
RUN npm run build

# Production Stage: Use Google Cloud SDK for GKE deployment
FROM google/cloud-sdk:alpine

# Set the working directory inside the container
WORKDIR /app

# Install the GKE gcloud auth plugin
RUN gcloud components install gke-gcloud-auth-plugin

# Copy built app from builder
COPY --from=builder /app /app

# Expose the port the app will run on
EXPOSE 3000

# Define the command to run your app
CMD ["npm", "start"]
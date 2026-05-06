FROM node:20  AS builder
WORKDIR /line-reservation-api
COPY ./package*.json /line-reservation-api/
RUN npm ci
COPY . /line-reservation-api/
RUN npm run build

# for ncc

# FROM node:14-alpine
# WORKDIR /eo-api-v2
# COPY --from=builder /eo-api-v2/dist ./
# COPY --from=builder /eo-api-v2/package.json ./
# RUN npm install typeorm@0.2.43

# CMD ["npm", "run", "start:prod-new"]
CMD ["npm", "run", "start:prod"]

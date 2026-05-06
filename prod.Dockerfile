FROM node:20  AS builder
WORKDIR /line-reservation-api
COPY ./api/package*.json /line-reservation-api/
COPY ./api/yarn.lock /line-reservation-api/
RUN yarn
COPY ./api /line-reservation-api/
RUN yarn build

# for ncc

# FROM node:14-alpine
# WORKDIR /eo-api-v2
# COPY --from=builder /eo-api-v2/dist ./
# COPY --from=builder /eo-api-v2/package.json ./
# RUN yarn add typeorm@0.2.43

# CMD ["yarn", "start:prod-new"]
CMD ["yarn", "start:prod"]
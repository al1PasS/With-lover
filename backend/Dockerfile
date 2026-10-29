FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -B dependency:go-offline
COPY src ./src
RUN mvn -B package
FROM eclipse-temurin:21.0.8_9-jre-alpine
RUN addgroup -S shiguang && adduser -S shiguang -G shiguang
WORKDIR /app
COPY --from=build /app/target/couple-memory-0.1.0.jar app.jar
USER shiguang
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]

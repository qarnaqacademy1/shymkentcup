
CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY,"email" TEXT NOT NULL,"passwordHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"settings" TEXT NOT NULL,"history" TEXT);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "Credential" ("id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"hash" TEXT NOT NULL,"kind" TEXT NOT NULL,"instanceId" TEXT,"name" TEXT NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "Credential_hash_key" ON "Credential"("hash");
CREATE TABLE "PairCode" ("hash" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "PairCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE TABLE "StudySession" ("id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"clientSessionId" TEXT NOT NULL,"instanceId" TEXT NOT NULL,"startedAt" TIMESTAMP(3) NOT NULL,"endedAt" TIMESTAMP(3) NOT NULL,"payload" TEXT NOT NULL,"payloadHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "StudySession_userId_clientSessionId_key" ON "StudySession"("userId","clientSessionId");
CREATE INDEX "StudySession_userId_startedAt_idx" ON "StudySession"("userId","startedAt");

CREATE TABLE "RateLimit" ("key" TEXT NOT NULL PRIMARY KEY, "total" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);

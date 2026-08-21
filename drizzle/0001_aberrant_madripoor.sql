CREATE TABLE `documentAnalyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`mimeType` varchar(100) NOT NULL,
	`originalKey` text NOT NULL,
	`originalUrl` text NOT NULL,
	`overlayKey` text NOT NULL,
	`overlayUrl` text NOT NULL,
	`prediction` enum('genuine','forged') NOT NULL,
	`forgeryScore` int NOT NULL,
	`tamperingTypes` text NOT NULL,
	`flaggedRegions` text NOT NULL,
	`explanation` text NOT NULL,
	`modelVersion` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documentAnalyses_id` PRIMARY KEY(`id`)
);

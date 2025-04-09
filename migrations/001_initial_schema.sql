-- Create salesman table
CREATE TABLE IF NOT EXISTS salesman (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE
);

-- Create building_types table
CREATE TABLE IF NOT EXISTS building_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(255) NOT NULL UNIQUE
);

-- Create postal_codes table for geographic lookups
CREATE TABLE IF NOT EXISTS postal_codes (
  postal_code VARCHAR(10) NOT NULL,
  village VARCHAR(100) NOT NULL,
  district VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  province VARCHAR(100) NOT NULL,
  search_timestamp DATETIME NOT NULL,
  PRIMARY KEY (postal_code, village),
  KEY idx_postal_code (postal_code),
  KEY idx_village (village),
  KEY idx_district (district),
  KEY idx_city (city)
);

-- Create submissions table
CREATE TABLE IF NOT EXISTS submissions (
  id VARCHAR(36) PRIMARY KEY,
  timestamp DATETIME NOT NULL,
  salesmanName VARCHAR(255) NOT NULL,
  customerName VARCHAR(255) NOT NULL,
  customerAddress TEXT NOT NULL,
  village TEXT NOT NULL,
  coordinates VARCHAR(255) NOT NULL,
  buildingType VARCHAR(255) NOT NULL,
  operators JSON NOT NULL
);

-- Create building_photos table
CREATE TABLE IF NOT EXISTS building_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  submission_id VARCHAR(36) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id)
);

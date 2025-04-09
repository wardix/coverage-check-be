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

-- Create villages table
CREATE TABLE IF NOT EXISTS villages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE
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

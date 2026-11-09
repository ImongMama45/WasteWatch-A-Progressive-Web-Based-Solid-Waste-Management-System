# Chapter 3 System Diagrams

Here are the Mermaid.js codes for all the diagrams required in your Chapter 3. You can copy and paste these code blocks directly into any Mermaid-compatible tool (like [Mermaid Live Editor](https://mermaid.live/), Notion, or Obsidian) to generate high-quality images for your document.

## 1. Figure 1: Conceptual Framework (IPO Diagram)
This diagram illustrates the Input-Process-Output flow of WasteWatch.

```mermaid
flowchart LR
    subgraph Inputs[Input]
        direction TB
        I1(Resident & Barangay Data)
        I2(Waste Incident Reports)
        I3(GPS Location Data)
        I4(System Settings)
    end

    subgraph Processes[Process]
        direction TB
        P1(Hotspot Mapping & GIS Analysis)
        P2(Route Optimization Algorithm)
        P3(Real-time Truck Tracking)
        P4(Predictive Analytics & Reporting)
    end

    subgraph Outputs[Output]
        direction TB
        O1(Optimized Collection Routes)
        O2(Real-time Fleet Dashboards)
        O3(Waste Hotspot Alerts)
        O4(System Performance Analytics)
    end

    Inputs --> Processes
    Processes --> Outputs
    
    style Inputs fill:#e3f2fd,stroke:#1e88e5
    style Processes fill:#fff3e0,stroke:#fb8c00
    style Outputs fill:#e8f5e9,stroke:#43a047
```

## 2. Figure 2: Software Development Lifecycle (Agile Scrum)
This diagram shows the iterative Agile methodology used to develop the system.

```mermaid
flowchart TD
    A([1. Planning Phase]) --> B([2. Requirement Analysis])
    B --> C([3. System Design])
    C --> D([4. Development Phase])
    D --> E([5. Testing Phase])
    
    E -- Bug Fixes / Refinement --> D
    
    E --> F([6. Deployment & Maintenance])
    
    F -- New Sprint / Next Iteration --> A
    
    style A fill:#ede7f6,stroke:#5e35b1
    style B fill:#ede7f6,stroke:#5e35b1
    style C fill:#ede7f6,stroke:#5e35b1
    style D fill:#ede7f6,stroke:#5e35b1
    style E fill:#ede7f6,stroke:#5e35b1
    style F fill:#ede7f6,stroke:#5e35b1
```

## 3. Figure 3: System Sequence Diagram (Driver Shift Tracking Flow)
This details the interactions when a driver performs a shift.

```mermaid
sequenceDiagram
    participant Driver
    participant App as WasteWatch App
    participant DB as System Database
    participant Watcher as Watcher/Barangay Official

    Driver->>App: Start Shift
    App->>DB: Record Shift Start & Location
    DB-->>App: Return Active Route & Stops
    
    loop During Collection
        Driver->>App: Arrive at Stop
        App->>DB: Log GPS Location Ping
        Driver->>App: Mark Stop Completed + Upload Photo
        App->>DB: Save Collection Confirmation
        DB-->>Watcher: Send Real-time Notification
        Watcher->>App: Verify Stop (Camera Modal)
        App->>DB: Save Stop Validation
    end
    
    Driver->>App: End Shift
    App->>DB: Generate Completion Report
    DB-->>App: Shift Summary Dashboard
```

## 4. Figure 4: Context Diagram (System Boundaries)
This provides a high-level view of how external entities interact with WasteWatch.

```mermaid
flowchart TD
    Admin[Admin / System Administrator]
    Driver[Driver / Sanitation Worker]
    Resident[Resident / Citizen]
    Watcher[Watcher / Barangay Official]
    GPS[GPS / Mapping Service]

    System((WasteWatch\nSystem))

    Admin <-->|Config, Analytics, Routes| System
    Driver <-->|GPS, Collection Logs, Routes| System
    Resident <-->|Complaints, Schedules, Alerts| System
    Watcher <-->|Verifications, Escalations, Reports| System
    GPS -->|Location Data, Routing Paths| System

    style System fill:#2196f3,stroke:#0d47a1,color:#fff,stroke-width:4px
```

## 5. Figure 5: Data Flow Diagram (DFD Level 0)
This maps the major processes based on your actual, full-scale system architecture.

```mermaid
flowchart LR
    %% External Entities
    E1[Admin]
    E2[Driver]
    E3[Resident]
    E4[Watcher]

    %% Processes
    P1((1.0\nUser\nManagement))
    P2((2.0\nWaste & Hotspot\nManagement))
    P3((3.0\nCollection &\nFleet Mgmt))
    P4((4.0\nDumpsite\nManagement))
    P5((5.0\nNotification\nManagement))
    P6((6.0\nAnalytics &\nPredictions))

    %% Data Flow
    E1 --> P1 & P3 & P5
    E2 <--> P3
    E2 --> P4
    E3 --> P2
    E3 <--> P5
    E4 --> P2 & P3
    
    P1 <--> P2 & P3 & P4 & P5 & P6
    P2 --> P3
    P3 --> P6
    P4 --> P6
    
    style P1 fill:#e1bee7,stroke:#8e24aa
    style P2 fill:#c8e6c9,stroke:#388e3c
    style P3 fill:#bbdefb,stroke:#1976d2
    style P4 fill:#ffccbc,stroke:#e64a19
    style P5 fill:#fff9c4,stroke:#fbc02d
    style P6 fill:#d7ccc8,stroke:#5d4037
```

## 6. Figure 6: Entity Relationship Diagram (ERD)
This is the fully expanded ERD that accurately matches your 20+ database tables, rather than the simplified 7-entity version.

```mermaid
erDiagram
    %% Core Users and Areas
    Users ||--o{ Waste_Reports : submits
    Users ||--o{ Driver_Shifts : performs
    Users ||--o{ Notifications : receives
    Users }|--|| Barangays : belongs_to
    Barangays ||--o{ Garbage_Hotspots : contains

    %% Waste and Hotspots
    Waste_Reports }|--|| Barangays : located_in
    Waste_Reports ||--o{ Escalations : triggers

    %% Fleet and Routing
    Trucks ||--o{ Driver_Shifts : assigned_to
    Trucks ||--o{ Truck_Locations : generates
    Driver_Shifts ||--o{ Route_Assignments : has
    Route_Assignments ||--o{ Stop_Validations : verified_by
    Route_Assignments ||--o{ Collection_Confirmations : completed_by

    %% Dumpsite operations
    Driver_Shifts ||--o{ Waste_Deliveries : deposits
    Dumpsites ||--o{ Waste_Deliveries : receives

    %% Analytics and Settings
    Users ||--o{ Activity_Logs : creates
    Barangays ||--o{ Barangay_Performances : has

    %% Definitions (Simplified attributes for visual clarity)
    Users {
        int user_id PK
        string role
        string name
    }
    Waste_Reports {
        int report_id PK
        string photo_evidence
        string status
    }
    Driver_Shifts {
        int shift_id PK
        datetime start_time
    }
    Route_Assignments {
        int route_id PK
        string status
    }
    Dumpsites {
        int site_id PK
        string capacity
    }
```

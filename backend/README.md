# SlopeSentinel Backend

Python FastAPI server for geotechnical terrain intelligence, DepthWizard depth reconstruction pipeline, change detection analytics, and risk evaluation.

## Setup Instructions

1. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run the development server:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

The backend API will be available at `http://localhost:8000` with documentation at `http://localhost:8000/docs`.

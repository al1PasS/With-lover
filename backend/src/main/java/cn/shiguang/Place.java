package cn.shiguang;
import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
@Entity @Table(name="places")
class Place {
 @Id UUID id=UUID.randomUUID();
 @Column(nullable=false) String city;
 @Column(nullable=false) String name;
 @Column(columnDefinition="text") String referenceImage="";
 @Column(columnDefinition="text") String panoramaImage="";
 @Column(columnDefinition="text") String generationPrompt="";
 LocalDate visitDate;
 @Column(nullable=false,length=500) String description="";
 @Column(nullable=false) int sortOrder=0;
 Instant createdAt=Instant.now();
 protected Place(){}
}
